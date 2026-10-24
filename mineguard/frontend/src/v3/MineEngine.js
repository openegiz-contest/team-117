/**
 * MineGuard X / Isometric Mine v3 — true realtime WebGL scene.
 * Geometry is procedural and illustrative, NOT a surveyed mine model.
 * Synthetic / live provenance is handled by the surrounding dashboard.
 * Uses the same MineScene API as the original application.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// Probed before the real context is created, so MSAA can be disabled on CPU WebGL.
import { isSoftwareRenderer } from '../renderProfile';

const AQUA = 0x14eeff;
const ICE = 0x8ff9ff;
const YELLOW = 0xffc247;
const ALERT = 0xff506e;
const VERTICAL = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const math = THREE.MathUtils;
const point = (x, y, z) => new THREE.Vector3(x, y, z);
function seeded(seed = 7331) { let s=seed >>> 0; return () => ((s = (1664525*s + 1013904223)>>>0) / 4294967296); }
const mat = (color, metalness = .3, roughness = .73, extra={}) => new THREE.MeshStandardMaterial({color, metalness, roughness, ...extra});
const unlit = (color, extra={}) => new THREE.MeshBasicMaterial({color, ...extra});
const UNKNOWN = 0xb794f6;
const RISK_COLOR = {NORMAL:AQUA, ADVISORY:YELLOW, WARNING:YELLOW, EMERGENCY:ALERT, UNKNOWN_DATA:UNKNOWN};

// Static meshes whose materials render identically can share one draw call.
const materialKey=m=>[m.type,m.color?.getHexString(),m.emissive?.getHexString(),m.emissiveIntensity,m.metalness,m.roughness,
  m.flatShading,m.side,m.transparent,m.opacity,m.vertexColors,m.depthWrite,m.blending].join('|');

// The render anchors are distinct from API zone topology, which remains authoritative.
const ANCHORS = {
  'Z01': point(-11.8,1.9,-1.5),
  'Z02': point(12,1.6,-5.3),
  'Z03': point(-2.5,1.9,-10.5),
  'Z04': point(7.5,2.4,-18),
  'Z05': point(-21,1.5,5.7),
  'Z06': point(-31,1.1,9.7)
};
const CAM_POS=point(35,27.5,54);
const CAM_TARGET=point(0,-.65,3.8);

function roundedRectCurve(x0, x1, z0, z1, radius, y) {
  const c=new THREE.CurvePath();
  const ln=(a,b)=>c.add(new THREE.LineCurve3(point(...a),point(...b)));
  const corner=(a,b,d)=>c.add(new THREE.QuadraticBezierCurve3(point(...a),point(...b),point(...d)));
  const r=radius;
  ln([x0+r,y,z0],[x1-r,y,z0]);
  corner([x1-r,y,z0],[x1,y,z0],[x1,y,z0+r]);
  ln([x1,y,z0+r],[x1,y,z1-r]);
  corner([x1,y,z1-r],[x1,y,z1],[x1-r,y,z1]);
  ln([x1-r,y,z1],[x0+r,y,z1]);
  corner([x0+r,y,z1],[x0,y,z1],[x0,y,z1-r]);
  ln([x0,y,z1-r],[x0,y,z0+r]);
  corner([x0,y,z0+r],[x0,y,z0],[x0+r,y,z0]);
  return c;
}
function smooth(coords, tension=.28) {
  return new THREE.CatmullRomCurve3(coords.map(p => point(...p)), false, 'catmullrom', tension);
}
function renderRibbon(curve, width, yOffset, material, samples=96){
  const vertices=[], uv=[], indices=[];
  for(let i=0;i<=samples;i++) {
    const t=i/samples, p=curve.getPoint(t), v=curve.getTangent(t).normalize();
    const normal=point(-v.z,0,v.x).normalize();
    const a=p.clone().addScaledVector(normal,width/2), b=p.clone().addScaledVector(normal,-width/2);
    vertices.push(a.x,p.y+yOffset,a.z,b.x,p.y+yOffset,b.z);
    uv.push(0,t*16,1,t*16);
    if(i<samples){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(indices);g.computeVertexNormals();
  return new THREE.Mesh(g,material);
}

export class MineEngine {
  constructor(container, onPositions, onSelectZone=()=>{}) {
    this.container=container;
    this.onPositions=onPositions;
    this.onSelectZone=onSelectZone;
    this.disposed=false;
    this.airflow=true;
    this.wireframe=false;
    this.selected='Z04';
    this.data=null;
    this.beamMeshes=[];
    this.particleSpecs=[];
    this.arrowSpecs=[];
    this.structuralMaterials=[];
    this.fanRims=[];
    this.softwareRenderer=isSoftwareRenderer();
    // One shared set of flow materials lets every airflow beam merge into three draw calls.
    this.flowMats={
      halo:unlit(0x00d5ff,{transparent:true,opacity:.14,depthWrite:false,blending:THREE.AdditiveBlending}),
      glow:unlit(0x00f0ff,{transparent:true,opacity:.25,depthWrite:false,blending:THREE.AdditiveBlending}),
      line:unlit(0x8affff,{transparent:true,opacity:.98,depthWrite:false}),
      arrow:unlit(ICE,{transparent:true,opacity:.95,depthWrite:false,blending:THREE.AdditiveBlending}),
      particle:unlit(0xc4ffff,{transparent:true,opacity:.96,depthWrite:false,blending:THREE.AdditiveBlending}),
    };
    this.zoneLights=new Map();
    this.zoneAnchors=new Map(Object.entries(ANCHORS));
    this.clickTargets=[];
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x020d16);
    this.scene.fog=new THREE.FogExp2(0x020d16,.0037);
    this.camera=new THREE.PerspectiveCamera(37,1,.1,360);
    this.camera.position.copy(CAM_POS);
    this.renderer=new THREE.WebGLRenderer({antialias:!this.softwareRenderer,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(this.softwareRenderer?.5:Math.min(window.devicePixelRatio || 1,1.5));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=this.softwareRenderer?1.45:1.72;
    this.renderer.domElement.className='three-canvas';
    this.renderer.domElement.dataset.renderProfile=this.softwareRenderer?'v3-software-lite':'v3-hardware';
    this.lastRender=0;
    container.appendChild(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;
    this.controls.dampingFactor=.06;
    this.controls.enablePan=true;
    this.controls.minDistance=24;
    this.controls.maxDistance=145;
    this.controls.minPolarAngle=.22;
    this.controls.maxPolarAngle=Math.PI*.48;
    this.controls.target.copy(CAM_TARGET);
    this.controls.update();
    this.group=new THREE.Group();this.scene.add(this.group);
    this.clock=new THREE.Clock();
    this.elapsed=0;this.lastLabelAt=-1;
    this.build();
    this.mergeStaticMeshes();
    if(this.softwareRenderer)this.useLambertMaterials();
    this.buildFlowInstances();
    this.raycaster=new THREE.Raycaster();
    this.pointer=new THREE.Vector2();
    this.pointerDown=null;
    this.onPointerDown=e=>{this.pointerDown={x:e.clientX,y:e.clientY};};
    this.onPointerUp=e=>{
      if(!this.pointerDown || Math.hypot(e.clientX-this.pointerDown.x,e.clientY-this.pointerDown.y)>6)return;
      const r=this.renderer.domElement.getBoundingClientRect();
      this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
      this.raycaster.setFromCamera(this.pointer,this.camera);
      const hit=this.raycaster.intersectObjects(this.clickTargets,true)[0];
      if(hit){let obj=hit.object;while(obj&&!obj.userData?.zoneId)obj=obj.parent;
        if(obj?.userData?.zoneId)this.onSelectZone(obj.userData.zoneId);
      }
    };
    this.renderer.domElement.addEventListener('pointerdown',this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup',this.onPointerUp);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
    this.resize();this.loop=this.loop.bind(this);this.frame=requestAnimationFrame(this.loop);
  }
  add(mesh,parent=this.group){parent.add(mesh);return mesh;}
  box(w,h,d,x,y,z,material,parent=this.group){
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    m.position.set(x,y,z);this.add(m,parent);return m;
  }
  cylinder(rad,depth,x,y,z,material,parent=this.group){
    const m=new THREE.Mesh(new THREE.CylinderGeometry(rad,rad,depth,24),material);
    m.rotation.x=Math.PI/2;m.position.set(x,y,z);this.add(m,parent);return m;
  }
  tube(curve,radius,material,segments=120,sides=7,parent=this.group){
    const lite=this.softwareRenderer;
    const geometry=new THREE.TubeGeometry(curve,lite?Math.max(16,Math.round(segments/2)):segments,radius,lite?Math.max(4,sides-2):sides,false);
    const m=new THREE.Mesh(geometry,material);
    this.add(m,parent);return m;
  }
  build(){
    this.scene.add(new THREE.HemisphereLight(0xb9e8ed,0x14222a,2.15));
    this.scene.add(new THREE.AmbientLight(0x2d7894,.63));
    const sun=new THREE.DirectionalLight(0xdbf1f3,3.0);sun.position.set(-26,35,30);this.scene.add(sun);
    // Point lights are evaluated per fragment; CPU WebGL keeps only the global lights.
    if(!this.softwareRenderer){
      const blue=new THREE.PointLight(0x00e6ff,135,65,1.5);blue.position.set(0,12,1);this.scene.add(blue);
      const back=new THREE.PointLight(0x1c94ff,84,46,1.8);back.position.set(0,8,-17);this.scene.add(back);
    }
    const grid=new THREE.GridHelper(112,46,0x08617a,0x0a3043);
    grid.position.y=-6.8;grid.material.opacity=.20;grid.material.transparent=true;this.group.add(grid);
    this.makeRockBed();
    this.makeCutawayCliffs();
    this.makePlateau();
    this.makeProductionWorkings();
    this.makeIndustrialDetails();
    this.makeForegroundDucts();
    this.makeMainFan();
    this.makeSensors();
  }
  makeRockBed(){
    const rock=mat(0x162c36,.09,1,{flatShading:true});
    const rock2=mat(0x25404a,.05,.99,{flatShading:true});
    const random=seeded(2026);
    // Instanced low-poly, layered rock for the cutaway terrain: not a cloud of random debris.
    for(const [count,material,scale] of [[260,rock,1.0],[120,rock2,.54]]){
      const geo=new THREE.DodecahedronGeometry(1,0);
      const ins=new THREE.InstancedMesh(geo,material,count);
      const proxy=new THREE.Object3D();
      for(let i=0;i<count;i++){
        let x,z;
        // Distribute stones around the rear excavation and ducts, leave the tunnel lanes clear.
        if(i<count*.65){
          const edge=Math.floor(random()*4);
          x=edge<2?(random()-.5)*44:(edge===2?-21-random()*4:21+random()*4);
          z=edge<2?(edge===0?-24-random()*3:3+random()*5):(random()*32-24);
        } else {x=(random()-.5)*75;z=(random()-.5)*71;}
        const s=scale*(.6+random()*2.4);
        proxy.position.set(x,-4.4+random()*1.0,z);
        proxy.rotation.set(random()*3,random()*6,random()*3);
        proxy.scale.set(s,.42*s,s*(.6+random()*.55));
        proxy.updateMatrix();ins.setMatrixAt(i,proxy.matrix);
      }
      ins.instanceMatrix.needsUpdate=true;this.add(ins);
    }
    // Strata foundations beneath the elevated workings.
    const base=mat(0x253b43,.08,.99,{flatShading:true});
    this.box(42,4.0,29,-.2,-3.8,-10.8,base);
    for(let k=0;k<4;k++) {
      const slab=this.box(42+k*.5,.35,29+k*.45,-.2,-5.7-k*.26,-10.8,mat(k%2?0x132e37:0x25434a,.08,.97));
      slab.rotation.y=(k%2?-.01:.01);
    }
    const rim=mat(0x315260,.3,.85,{flatShading:true});
    for(let k=0;k<90;k++){
      const x=-19+seeded(300+k)()*38;
      const z=k%2===0?-24.7:3.1;
      const m=new THREE.Mesh(new THREE.DodecahedronGeometry(.4+(k%5)*.20,0),rim);
      m.position.set(x,-1.22,z+(k%4)*.12);m.scale.set(1,.9,1.15);this.add(m);
    }
  }
  /** Layered rock escarpments: irregular silhouette + flat-shaded strata; walls
   * lie OUTSIDE the playable galleries so they do not occlude the production lanes.
   * All material is deterministic synthetic artwork, not a surveyed mine.
   */
  makeCutawayCliffs(){
    const rockMat=new THREE.MeshStandardMaterial({vertexColors:true,flatShading:true,roughness:1,metalness:0.04,side:THREE.DoubleSide});
    const tri=[],rgb=[];
    const rand=seeded(7319);
    const palette=[0x30464d,0x364b51,0x3e555a,0x43595d,0x2a4049,0x4c6163,0x253942];
    const pushTri=(a,b,c,color)=>{
      const shade=new THREE.Color(color);
      for(const p of [a,b,c]){tri.push(p.x,p.y,p.z);rgb.push(shade.r,shade.g,shade.b);}
    };
    const quad=(a,b,c,d,color)=>{pushTri(a,b,c,color);pushTri(a,c,d,color);};
    const strips=[
      // back rock rises above the mining face
      {start:[-22,-25.8],end:[22,-25.8],out:[0,-1],top:2.0,bottom:-6.4,width:5},
      {start:[-21.3,-24.8],end:[-21.3,3.3],out:[-1,0],top:1.25,bottom:-6.2,width:4.5},
      {start:[21.3,-24.8],end:[21.3,3.3],out:[1,0],top:1.35,bottom:-6.2,width:4.5},
      // exposed geological cutaway at the front, beneath the mining complex
      {start:[-21.2,3.65],end:[21.2,3.65],out:[0,1],top:-1.36,bottom:-6.2,width:3.8}
    ];
    for (const wall of strips){
      const steps=wall.start[0]===wall.end[0]?34:48;
      const get=(i,side,y)=>{
        const t=i/steps,idx=i;
        const x=math.lerp(wall.start[0],wall.end[0],t);
        const z=math.lerp(wall.start[1],wall.end[1],t);
        const wobble=Math.sin(t*31)*.21+Math.sin(t*73)*.16;
        return point(x+wall.out[0]*(side*wall.width+wobble),y,z+wall.out[1]*(side*wall.width+wobble));
      };
      for(let i=0;i<steps;i++){
        const t=i/steps,tn=(i+1)/steps;
        const h1=wall.top+Math.sin(t*39)*.42+Math.cos(t*71)*.33;
        const h2=wall.top+Math.sin(tn*39)*.42+Math.cos(tn*71)*.33;
        const j1=h1-.5-rand()*.4,j2=h2-.5-rand()*.4;
        const a=get(i,0,h1),b=get(i+1,0,h2),c=get(i+1,0,wall.bottom),d=get(i,0,wall.bottom);
        const e=get(i,1,h1+rand()*.65),f=get(i+1,1,h2+rand()*.65);
        const g=get(i,1,wall.bottom),h=get(i+1,1,wall.bottom);
        const m=get(i,.18,j1),n=get(i+1,.18,j2);
        const color=palette[Math.floor(rand()*palette.length)];
        quad(a,b,n,m,color);
        quad(m,n,c,d,palette[Math.floor(rand()*palette.length)]);
        quad(e,f,b,a,palette[Math.floor(rand()*palette.length)]);
        quad(f,h,c,b,color);
        quad(g,d,c,h,palette[Math.floor(rand()*palette.length)]);
      }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(tri,3));
    geo.setAttribute('color',new THREE.Float32BufferAttribute(rgb,3));
    geo.computeVertexNormals();
    const cliff=this.add(new THREE.Mesh(geo,rockMat));
    cliff.receiveShadow=true;this.structuralMaterials.push(rockMat);
    // Irregular ore seam and fracture highlights on the exposed front face.
    const seam=mat(0x65787a,.25,.92,{emissive:0x132932,emissiveIntensity:.33});
    const quartz=mat(0x658b91,.15,.85);
    for (let k=0;k<3;k++){
      const curve=smooth(Array.from({length:12},(_,i)=>[
        -20+i*(40/11),-3.0-k*.9+Math.sin(i*1.85+k)*.18,3.68+Math.cos(i*1.4+k)*.09
      ]));
      this.tube(curve,.056,k===0?quartz:seam,96,5);
    }
    // Non-uniform raised ledges along the top of the rear cliff.
    const ledgeA=mat(0x344a51,.12,1,{flatShading:true});
    const ledgeB=mat(0x51666b,.08,.98,{flatShading:true});
    const shape=new THREE.IcosahedronGeometry(1,0);
    const count=175,inst=new THREE.InstancedMesh(shape,ledgeA,count);
    const obj=new THREE.Object3D();
    for(let i=0;i<count;i++){
      const lane=i%4;
      const x=lane===0?-23.6+rand()*1.7:lane===1?23.2+rand()*2.1:-20+rand()*40;
      const z=lane===0||lane===1?-23.6+rand()*27:-29.3+rand()*5.3;
      const size=.55+rand()*1.35;
      obj.position.set(x,.45+rand()*1.5,z);
      obj.rotation.set(rand()*3,rand()*6,rand()*3);
      obj.scale.set(size,size*.7,size*.7);obj.updateMatrix();inst.setMatrixAt(i,obj.matrix);
    }
    inst.instanceMatrix.needsUpdate=true;this.add(inst);
    // Small pale ore clusters increase texture without covering the airways.
    const oreGeo=new THREE.DodecahedronGeometry(.32,0);
    const oreInst=new THREE.InstancedMesh(oreGeo,ledgeB,48);
    for(let i=0;i<48;i++){
      const x=-19+rand()*38,z=-27.2-rand()*1.9;
      obj.position.set(x,.5+rand()*1.0,z);
      obj.rotation.set(rand(),rand()*4,rand());obj.scale.set(.6+rand()*1.8,.6+rand()*1.8,.6+rand()*1.8);
      obj.updateMatrix();oreInst.setMatrixAt(i,obj.matrix);
    }
    oreInst.instanceMatrix.needsUpdate=true;this.add(oreInst);
  }

  /** Visible production equipment with legs, work lights, conveyor belt and
   * grounded steel support frames, deliberately placed between the roadway loops. */
  makeIndustrialDetails(){
    const steel=mat(0x68838b,.79,.4,{emissive:0x0c2430,emissiveIntensity:.3});
    const edge=mat(0x283b45,.76,.51);
    const deck=mat(0x344c57,.81,.47);
    const glow=unlit(0x86faff);
    const amber=unlit(0xffbe57);
    // Roof-like arch frames every few meters: strongly read as excavated industrial roadways.
    for(const z of [-17.85,-11.55,-5.20]){
      for(const x of [-11.5,-6.5,-1.5,3.5,8.5,13.5]){
        for(const side of [-1,1]){
          this.box(.18,1.22,.18,x+side*1.15,-.1,z,steel);
          this.box(.48,.14,.40,x+side*1.15,-.70,z,edge);
        }
        this.box(2.52,.17,.17,x,.51,z,steel);
        this.box(.55,.1,.1,x,.47,z,glow);
        if(!this.softwareRenderer && (x===-6.5||x===8.5) && z!==-11.55){
          const l=new THREE.PointLight(0x21c9e9,3,5.5,2);
          l.position.set(x,.3,z);this.scene.add(l);
        }
      }
    }
    // Conveyor and freight rails, set on the front part of the excavation.
    const conveyor=new THREE.Group();conveyor.position.set(0,-.92,-1.15);this.add(conveyor);
    this.box(29.6,.29,1.5,0,.2,0,deck,conveyor);
    this.box(28.9,.09,1.11,0,.39,0,edge,conveyor);
    for (const side of [-1,1])this.box(29.4,.16,.13,0,.54,side*.74,steel,conveyor);
    const wheelMat=mat(0x8b9ca1,.75,.38);
    for (let x=-13.8;x<14;x+=2.2){
      for(const side of [-1,1]){
        const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.29,.29,.23,12),wheelMat);
        wheel.rotation.x=Math.PI/2;
        wheel.position.set(x,.06,side*.85);this.add(wheel,conveyor);
      }
    }
    // Crate stacks, worker-safe barriers, lift housing, and production machinery.
    const yellow=mat(0xb9913e,.56,.58);
    for (const x of [-12,-4.2,4.7,12.5]){
      this.box(1.4,.8,.92,x,-.45,-8.2,steel);
      this.box(1.52,.12,1.06,x,.04,-8.2,deck);
      this.box(.13,.36,1.05,x-.8,-.45,-8.2,yellow);
    }
    for (const x of [-12.7,12.7]){
      this.box(2,.5,2.3,x,-.75,-15,deck);
      this.box(.75,1.5,.85,x,.21,-15,steel);
      this.box(.45,.45,.12,x,.49,-14.49,glow);
    }
    // Workface hazard lamps are emphasized in amber, distant from cyan airflow.
    for(const x of [-15,-8,0,8,15]){
      const g=new THREE.Group();g.position.set(x,-.5,-22.1);this.add(g);
      this.box(.16,.65,.16,0,.33,0,steel,g);
      const bulb=new THREE.Mesh(new THREE.BoxGeometry(.35,.19,.22),amber);
      bulb.position.y=.77;this.add(bulb,g);
    }
    // Additional layered ground slabs give dimension to the eastern/western return headings.
    for(const side of [-1,1]){
      const x=side*18.3;
      for(let i=0;i<7;i++)this.box(1.75,.16,2.7,x,-1.32,-20.5+i*3.1,i%2===0?steel:deck);
    }
  }

  /** Walkways and support shoes under the curved foreground vent tubing. */
  makeDuctServicePlatforms(){
    const steel=mat(0x48646b,.82,.47);
    const deck=mat(0x213b45,.60,.64);
    const grating=unlit(0x27758a,{transparent:true,opacity:.75});
    for(const x of [-24,-16,-8,8,16,24]){
      const z=12.9-Math.abs(x)*.13;
      this.box(5.9,.31,3.3,x,-2.25,z,deck);
      this.box(5.8,.045,.08,x,-2.05,z+1.15,grating);
      for(const dx of [-2.3,2.3]){
        this.box(.22,1.05,.24,x+dx,-1.57,z,steel);
        this.box(.45,.20,.46,x+dx,-2.14,z,steel);
      }
    }
    // Metallic bolts around fan face, which catch highlights during orbit.
    const bolt=mat(0x9dc2c8,.92,.2);
    for(let n=0;n<18;n++){
      const a=n*Math.PI*2/18;
      const b=new THREE.Mesh(new THREE.IcosahedronGeometry(.11,0),bolt);
      b.position.set(Math.cos(a)*2.9,1.4+Math.sin(a)*2.9,18.32);
      this.add(b);
    }
  }

  makePlateau(){
    const floor=mat(0x182b33,.42,.89);
    this.structuralMaterials.push(floor);
    this.box(36.6,.31,24.2,0,-1.43,-10.5,floor);
    const side=mat(0x26414a,.62,.62);
    for(let x=-16;x<=16;x+=4){
      for(const z of [-22.65,1.8]){
        const strut=this.box(3.2,.6,.3,x,-1.15,z,side);
        strut.rotation.y=.02;
      }
    }
    // Two long cable racks along the plate edges.
    const cable=mat(0x967543,.7,.39);
    for(const z of [-21.5,0]){
      this.box(35.4,.11,.17,0,-.75,z,cable);
      for(let x=-17;x<=17;x+=3.4)this.box(.1,.65,.11,x,-1.12,z,side);
    }
    // Steel rails that read as engineered corridors, not arbitrary tubes.
    const bay=mat(0x304752,.7,.4);
    for(let ix=-2;ix<=2;ix++){
      for(let iz=-2;iz<=1;iz++){
        const x=ix*5.2,z=iz*4.8-9.1;
        const machine=this.addMachine(x,-.85,z,1+(Math.abs(ix)%2)*.16,bay);
        if((ix+iz)%3===0)machine.rotation.y=.19;
      }
    }
  }
  addMachine(x,y,z,scale=1,material){
    const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(scale);this.add(g);
    const metal=material||mat(0x526872,.76,.39);
    this.box(2.1,.65,1.45,0,.33,0,metal,g);
    this.box(2.45,.16,1.85,0,.72,0,mat(0x79949a,.7,.33),g);
    this.box(1.25,.45,.85,.15,1.03,-.10,metal,g);
    const dark=mat(0x10252e,.5,.4);
    this.box(.61,.43,.1,-.45,1.02,.45,dark,g);
    this.box(.65,.09,.07,-.45,1.13,.51,unlit(0x19d4de),g);
    for (const side of [-1,1]){
      this.box(.16,.35,1.9,side*1.13,.18,0,dark,g);
    }
    return g;
  }
  addRoadway(curve,{width=2.4,intensity=.9,arrows=true,particles=16,kind='back'}={}){
    const under=mat(0x051620,.42,.72,{side:THREE.DoubleSide});
    const trench=this.add(renderRibbon(curve,width,-.25,under,110));
    this.structuralMaterials.push(under);
    // Thin steel edging and cyan side lamps create clearly readable paths.
    const mainRail=mat(0x3c606a,.84,.32,{emissive:0x003a50,emissiveIntensity:.8});
    const lightRail=unlit(0x00daeb,{transparent:true,opacity:.95});
    for(const sign of [-1,1]){
      const samples=[];
      for(let k=0;k<=125;k++){
        const u=k/125,p=curve.getPoint(u),t=curve.getTangent(u).normalize();
        const n=point(-t.z,0,t.x).normalize();
        samples.push(p.clone().addScaledVector(n,sign*(width*.48)).add(point(0,.14,0)));
      }
      const line=new THREE.CatmullRomCurve3(samples);
      this.tube(line,.09,mainRail,145,6);
      this.tube(line,.033,lightRail,145,4);
    }
    // Dual inner airflow: soft aura + bright core, elevated above roadway.
    this.addFlow(curve,{intensity,particles,arrows,height:.29,radius:kind==='back'?.32:.35});
    if(kind==='back'){
      const pillar=mat(0x466673,.82,.43);
      for(let i=0;i<11;i++){
        const u=(i+.6)/11,p=curve.getPoint(u);
        const t=curve.getTangent(u),n=point(-t.z,0,t.x).normalize();
        if(!Number.isFinite(n.x))continue;
        for (const side of [-1,1]){
          const pp=p.clone().addScaledVector(n,side*(width*.48));
          this.box(.10,.47,.10,pp.x,p.y-.12,pp.z,pillar);
        }
      }
    }
    return trench;
  }
  addFlow(curve,{intensity=1,particles=12,arrows=true,height=.1,radius=.2}={}){
    const segments=112;
    const cpts=Array.from({length:segments+1},(_,i)=>curve.getPoint(i/segments).add(point(0,height,0)));
    const raised=new THREE.CatmullRomCurve3(cpts);
    const beams=[[radius*1.65,this.flowMats.glow,6],[radius*.44,this.flowMats.line,5]];
    // The wide additive halo is pure fill-rate cost on CPU WebGL.
    if(!this.softwareRenderer)beams.unshift([radius*3,this.flowMats.halo,5]);
    for(const [r,material,sides] of beams)this.tube(raised,r,material,segments,sides).userData.beam=true;
    // Arrowheads and particles travel along the roadway; they are drawn as two instanced meshes.
    if(arrows)for(let i=0;i<6;i++)this.arrowSpecs.push({curve:raised,phase:(i+.55)/6,speed:intensity});
    const count=this.softwareRenderer?Math.ceil(particles/2):particles;
    for(let i=0;i<count;i++)this.particleSpecs.push({curve:raised,phase:i/count,speed:intensity});
  }
  makeProductionWorkings(){
    // Three compact mining galleries with rectangular paths and rounded cut corners.
    // The systematic geometry resembles a real excavation plan from an isometric angle.
    const loops=[
      {x0:-15.3,x1:15.3,z0:-20.0,z1:-15.7,r:1.65},
      {x0:-15.3,x1:15.3,z0:-13.6,z1:-9.4,r:1.6},
      {x0:-15.3,x1:15.3,z0:-7.2,z1:-3.05,r:1.6}
    ];
    for(const [i,r] of loops.entries()){
      const c=roundedRectCurve(r.x0,r.x1,r.z0,r.z1,r.r,-.62);
      this.addRoadway(c,{width:2.12,intensity:.48+i*.11,particles:20,kind:'back'});
      // Short bridges between galleries.
      if(i<2){
        const connector=smooth([[-13.5,-.62,r.z1],[-13.5,-.62,loops[i+1].z0]]);
        this.addRoadway(connector,{width:1.6,intensity:.7,particles:7,kind:'back'});
      }
    }
    // Two arterial manifolds link the mine face to the foreground fan network.
    const left=smooth([[-24,.5,5.7],[-20,.1,3.4],[-15,-.62,-1],[-13.6,-.62,-3.3],[-13.6,-.62,-19.1]]);
    const right=smooth([[23,.5,6],[20,.2,3.8],[14.7,-.62,-.9],[13.5,-.62,-4],[13.5,-.62,-19.1]]);
    this.addRoadway(left,{width:1.4,intensity:.7,particles:16});
    this.addRoadway(right,{width:1.4,intensity:.8,particles:16});
    // Production face boundary: broken rock and amber warning worklights.
    const face=mat(0x30414a,.16,.98,{flatShading:true});
    const rand=seeded(13);
    for(let i=0;i<35;i++){
      const x=-16+rand()*32;
      const r=.35+rand()*.85;
      const m=new THREE.Mesh(new THREE.DodecahedronGeometry(r,0),face);
      m.position.set(x,-.5+rand()*.7,-22.5-rand()*.8);
      m.scale.set(.8,1+rand(),.8);this.add(m);
    }
    for(const x of [-13,-5,4,12]){
      this.addBeacon(x,0.05,-21,0xffc445);
    }
    const ore=mat(0x283f48,.32,.82);
    for (const x of [-10,-3,4,11]){
      const engine=this.addMachine(x,-.8,-18, .75,ore);
      engine.rotation.y=.15;
    }
  }
  makeForeDuct(curve,steps=17){
    // Perforated translucent industrial ventilation duct with metal arch supports.
    const shell=mat(0x173a47,.8,.33,{side:THREE.DoubleSide,transparent:true,opacity:.21,depthWrite:false});
    this.structuralMaterials.push(shell);
    this.tube(curve,1.36,shell,145,12);
    const hoopMat=mat(0x5c8790,.86,.3,{emissive:0x005d73,emissiveIntensity:.65});
    const sideRail=mat(0x78878b,.91,.27);
    const cable=mat(0xb78a43,.82,.3);
    for(let i=0;i<steps;i++){
      const u=(i+.3)/steps,p=curve.getPoint(u),t=curve.getTangent(u).normalize();
      const hoop=new THREE.Mesh(new THREE.TorusGeometry(1.46,.115,7,20),hoopMat);
      hoop.position.copy(p);
      hoop.quaternion.setFromUnitVectors(FORWARD,t);
      this.add(hoop);
    }
    for(const [offset,colorMat] of [[-1.0,sideRail],[1.0,sideRail],[-.1,cable]]){
      const pts=[];
      for(let i=0;i<=105;i++){
        const u=i/105,p=curve.getPoint(u),t=curve.getTangent(u).normalize();
        const lateral=point(-t.z,0,t.x).normalize();
        pts.push(p.clone().addScaledVector(lateral,offset).add(point(0,offset===-.1?1.24:-.48,0)));
      }
      this.tube(new THREE.CatmullRomCurve3(pts),.07,colorMat,120,5);
    }
    this.addFlow(curve,{intensity:1,particles:34,arrows:true,height:.36,radius:.26});
  }
  makeForegroundDucts(){
    // Fan feeds a Y-junction, reinforced ducts fork toward rear ventilation circuits.
    const fromSouth=smooth([[0,1.6,34],[0,1.6,29],[0,1.6,25],[0,1.6,19],[0,1.4,16]]);
    const left=smooth([[0,1.4,16],[-7,1.25,14],[-16,1.0,12],[-24,.9,10],[-28,.9,9.5],[-31,1.0,10]]);
    const right=smooth([[0,1.4,16],[8,1.25,14],[16,1.0,12],[24,.9,9],[29,.9,10]]);
    this.makeForeDuct(fromSouth,13);
    this.makeForeDuct(left,19);
    this.makeForeDuct(right,19);
    this.makeDuctServicePlatforms();
    // Intake / exhaust end structures and two stabilizing pylons.
    const steel=mat(0x64848e,.84,.29);
    for(const x of [-25,-16,16,25]){
      this.box(2.35,.36,2.4,x,-1.5,9.9,steel);
      this.box(.35,1.35,.3,x,-.83,9.9,steel);
    }
    const footing=mat(0x1e343f,.38,.67);
    this.box(8,.6,11,0,-2.25,19,footing);
    // Cyan air ribbons streaming in from the front shaft.
    for(const x of [-.9,-.42,.42,.9]){
      const c=smooth([[x,1.3,35],[x*.7,1.5,29],[x*.3,1.5,23],[0,1.55,17]]);
      this.addFlow(c,{particles:6,intensity:1.2,arrows:false,height:0,radius:.105});
    }
  }
  makeMainFan(){
    const fanGroup=new THREE.Group();fanGroup.position.set(0,1.4,17.5);this.group.add(fanGroup);
    const housing=mat(0x567985,.94,.23,{emissive:0x00394a,emissiveIntensity:.7});
    const inner=mat(0x0c222d,.8,.35);
    // Open-ended cylindrical shell: solid end caps would hide the moving blades.
    const housingShell=new THREE.Mesh(new THREE.CylinderGeometry(3.0,3.0,1.22,48,1,true),housing);
    housingShell.rotation.x=Math.PI/2;this.add(housingShell,fanGroup);
    const innerShell=new THREE.Mesh(new THREE.CylinderGeometry(2.63,2.63,1.30,48,1,true),inner);
    innerShell.rotation.x=Math.PI/2;this.add(innerShell,fanGroup);
    for(const depth of [-.74,.74]){
      const rim=new THREE.Mesh(new THREE.TorusGeometry(2.91,.27,12,48),housing);
      rim.position.z=depth;this.add(rim,fanGroup);
      const thin=new THREE.Mesh(new THREE.TorusGeometry(2.68,.066,8,48),unlit(0x19edff));
      thin.position.z=depth+.07;thin.userData.dynamic=true;this.add(thin,fanGroup);
      this.fanRims.push(thin);
    }
    this.fanSpin=new THREE.Group();this.fanSpin.position.z=.18;this.add(this.fanSpin,fanGroup);
    const bladeMat=mat(0xc9a34b,.8,.36,{side:THREE.DoubleSide});
    for(let n=0;n<8;n++){
      const pivot=new THREE.Group();pivot.rotation.z=n*Math.PI/4;
      const blade=new THREE.Mesh(new THREE.BoxGeometry(.70,2.13,.21),bladeMat);
      blade.position.y=1.19;blade.rotation.z=.48;blade.rotation.y=.27;
      pivot.add(blade);this.fanSpin.add(pivot);
    }
    this.cylinder(.60,.95,0,0,0,mat(0x8aafb8,.92,.25),this.fanSpin);
    this.cylinder(.24,1.05,0,0,0,mat(0x233d45,.73,.34),this.fanSpin);
    // Fan frame and inspection base.
    this.box(7.8,.42,4.7,0,-1.85,17.5,mat(0x38515c,.6,.53));
    for(const x of [-2.55,2.55])this.box(.25,2.5,.42,x,-.25,17.5,housing);
  }
  addBeacon(x,y,z,color){
    const grp=new THREE.Group();grp.position.set(x,y,z);this.add(grp);
    const steel=mat(0x3f6774,.82,.38);
    this.box(.16,.9,.16,0,.45,0,steel,grp);
    const bulb=new THREE.Mesh(new THREE.SphereGeometry(.18,9,8),unlit(color));
    bulb.position.y=.96;this.add(bulb,grp);
    return grp;
  }
  makeSensors(){
    for(const [id,pos] of Object.entries(ANCHORS)){
      const selected=id==='Z04', color=selected?YELLOW:AQUA;
      const marker=new THREE.Group();marker.position.copy(pos).add(point(0,-1.1,0));
      marker.userData.zoneId=id;
      this.add(marker);this.clickTargets.push(marker);
      const base=this.add(new THREE.Mesh(new THREE.CylinderGeometry(.65,.77,.20,16),mat(0x173b4d,.72,.34)),marker);
      base.position.y=-.1;
      const signal=new THREE.Mesh(new THREE.SphereGeometry(.26,14,9),unlit(color));
      signal.position.y=.15;this.add(signal,marker);
      const halo=new THREE.Mesh(new THREE.TorusGeometry(.8,.062,7,32),unlit(color,{transparent:true,opacity:.87}));
      halo.rotation.x=Math.PI/2;halo.position.y=-.02;this.add(halo,marker);
      const hit=new THREE.Mesh(new THREE.SphereGeometry(.86,12,9),unlit(0x00eeff,{transparent:true,opacity:0,depthWrite:false}));
      hit.position.y=.04;this.add(hit,marker);
      // False-colour methane volume: size and opacity follow the zone's Ditto CH4 reading.
      const gas=new THREE.Mesh(new THREE.SphereGeometry(1,18,12),unlit(YELLOW,{transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));
      gas.position.copy(pos).add(point(0,-.4,0));gas.visible=false;gas.userData.dynamic=true;this.add(gas);
      this.zoneLights.set(id,{signal,halo,gas,level:0});
    }
  }
  mergeStaticMeshes(){
    this.scene.updateMatrixWorld(true);
    const keep=new Set();
    for(const root of [this.fanSpin,...this.clickTargets])root?.traverse(o=>keep.add(o));
    const buckets=new Map(), victims=[];
    this.group.traverse(o=>{
      if(!o.isMesh||o.isInstancedMesh||keep.has(o)||o.userData.dynamic||Array.isArray(o.material))return;
      const key=materialKey(o.material)+(o.userData.beam?'|beam':'');
      let bucket=buckets.get(key);
      if(!bucket){bucket={material:o.material,geometries:[],beam:Boolean(o.userData.beam)};buckets.set(key,bucket);}
      if(this.structuralMaterials.includes(o.material)&&!this.structuralMaterials.includes(bucket.material))this.structuralMaterials.push(bucket.material);
      const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for(const name of Object.keys(g.attributes))if(!['position','normal','color'].includes(name))g.deleteAttribute(name);
      if(!g.attributes.normal)g.computeVertexNormals();
      bucket.geometries.push(g);victims.push(o);
    });
    const representatives=new Set([...buckets.values()].map(b=>b.material));
    for(const o of victims){
      o.parent.remove(o);o.geometry.dispose();
      if(!representatives.has(o.material))o.material.dispose();
    }
    this.structuralMaterials=this.structuralMaterials.filter(m=>representatives.has(m));
    for(const bucket of buckets.values()){
      const merged=mergeGeometries(bucket.geometries,false);
      bucket.geometries.forEach(g=>g.dispose());
      if(!merged)continue;
      const mesh=new THREE.Mesh(merged,bucket.material);
      this.group.add(mesh);
      if(bucket.beam)this.beamMeshes.push(mesh);
    }
  }
  useLambertMaterials(){
    // Physically based shading is the dominant per-pixel cost under SwiftShader/llvmpipe.
    const swaps=new Map();
    this.scene.traverse(o=>{
      if(!o.isMesh||!o.material?.isMeshStandardMaterial)return;
      const s=o.material;
      if(!swaps.has(s))swaps.set(s,new THREE.MeshLambertMaterial({color:s.color,emissive:s.emissive,emissiveIntensity:s.emissiveIntensity,
        flatShading:s.flatShading,side:s.side,transparent:s.transparent,opacity:s.opacity,vertexColors:s.vertexColors,depthWrite:s.depthWrite,wireframe:s.wireframe}));
      o.material=swaps.get(s);
    });
    this.structuralMaterials=this.structuralMaterials.map(m=>swaps.get(m)??m);
    swaps.forEach((_,s)=>s.dispose());
  }
  buildFlowInstances(){
    const instanced=(geometry,material,count)=>{
      const mesh=new THREE.InstancedMesh(geometry,material,Math.max(1,count));
      mesh.count=count;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);return mesh;
    };
    this.particleMesh=instanced(new THREE.SphereGeometry(.105,6,5),this.flowMats.particle,this.particleSpecs.length);
    this.arrowMesh=instanced(new THREE.ConeGeometry(.37,.98,5),this.flowMats.arrow,this.arrowSpecs.length);
    this.flowProxy=new THREE.Object3D();this.flowPoint=new THREE.Vector3();this.flowTangent=new THREE.Vector3();
    this.updateFlowInstances(0);
  }
  updateFlowInstances(intensity){
    const proxy=this.flowProxy;
    for(const [mesh,specs,rate,orient] of [[this.particleMesh,this.particleSpecs,.09,false],[this.arrowMesh,this.arrowSpecs,.032,true]]){
      specs.forEach((spec,i)=>{
        const t=((spec.phase+this.elapsed*rate*spec.speed*intensity)%1+1)%1;
        proxy.position.copy(spec.curve.getPoint(t,this.flowPoint));
        if(orient)proxy.quaternion.setFromUnitVectors(VERTICAL,spec.curve.getTangent(t,this.flowTangent).normalize());
        proxy.updateMatrix();mesh.setMatrixAt(i,proxy.matrix);
      });
      mesh.instanceMatrix.needsUpdate=true;
    }
  }
  setState(data, selected, airflow, wireframe){
    this.data=data;
    this.selected=selected;
    this.airflow=airflow;
    if(this.wireframe!==wireframe){
      this.wireframe=wireframe;
      this.structuralMaterials.forEach(m=>m.wireframe=wireframe);
    }
    for(const mesh of [...this.beamMeshes,this.particleMesh,this.arrowMesh])if(mesh)mesh.visible=airflow;
    for(const [id,parts] of this.zoneLights){
      const z=data?.zones?.find(v=>v.id===id);
      // Marker colour is the twin's risk state, not a renderer-side threshold.
      const color=RISK_COLOR[z?.risk]??UNKNOWN;
      parts.signal.material.color.setHex(color);
      parts.halo.material.color.setHex(color);
      parts.halo.scale.setScalar(id===selected?1.45:1);
      // Methane volume appears above 0.2 % and saturates at the 1.5 % emergency tier.
      const level=z?.ch4==null?0:math.clamp((z.ch4-.2)/1.3,0,1);
      parts.level=level;
      parts.gas.visible=level>.01;
      parts.gas.material.color.setHex(level>.6?ALERT:YELLOW);
      parts.gas.material.opacity=.1+.32*level;
    }
    const faulted=Boolean(data?.fan?.faulted);
    for(const rim of this.fanRims)rim.material.color.setHex(faulted?ALERT:0x19edff);
  }
  getPositions(){
    const rect=this.renderer.domElement.getBoundingClientRect();
    const result={};
    for(const [id,p] of this.zoneAnchors){
      const projection=p.clone().project(this.camera);
      result[id]={x:(projection.x*.5+.5)*rect.width,y:(-.5*projection.y+.5)*rect.height,visible:projection.z>=-1&&projection.z<1};
    }
    return result;
  }
  loop(now=performance.now()){
    if(this.disposed)return;
    // CPU WebGL: cap at ~20 fps so rendering never starves the page's input and data updates.
    if(this.softwareRenderer&&now-this.lastRender<50){this.frame=requestAnimationFrame(this.loop);return;}
    this.lastRender=now;
    const dt=Math.min(this.clock.getDelta(),.1);
    this.elapsed+=dt;
    this.controls.update();
    const rpm=this.data?.fan?.rpm ?? 0;
    if(this.fanSpin)this.fanSpin.rotation.z+=dt*Math.max(0,rpm/2850)*5;
    if(this.airflow&&this.particleMesh){
      // Particle speed follows the twin's intake airflow; zero flow (fan failure) stops them.
      const flow=this.data?.fan?.flow;
      this.updateFlowInstances(flow==null?1:math.clamp(flow/142.5,0,1.6));
    }
    for(const parts of this.zoneLights.values()){
      if(parts.gas.visible)parts.gas.scale.setScalar((.9+2.3*parts.level)*(1+.06*Math.sin(this.elapsed*2.1)));
    }
    this.renderer.render(this.scene,this.camera);
    this.renderedFrames=(this.renderedFrames??0)+1;
    if(now-(this.fpsWindowStart??now)>=1000||this.fpsWindowStart==null){
      if(this.fpsWindowStart!=null)this.renderer.domElement.dataset.renderFps=(this.renderedFrames*1000/(now-this.fpsWindowStart)).toFixed(1);
      this.fpsWindowStart=now;this.renderedFrames=0;
    }
    this.renderer.domElement.dataset.drawCalls=String(this.renderer.info.render.calls);
    this.renderer.domElement.dataset.triangles=String(this.renderer.info.render.triangles);
    this.renderer.domElement.dataset.camera=this.camera.position.toArray().map(v=>v.toFixed(3)).join(',');
    if(this.onPositions&&(this.elapsed-this.lastLabelAt>(this.softwareRenderer?.25:.083))){
      this.lastLabelAt=this.elapsed;
      // Label layout only changes with the camera or canvas size; skip DOM writes otherwise.
      const view=[...this.camera.matrixWorld.elements,this.camera.aspect,this.renderer.domElement.clientWidth].map(v=>v.toFixed(3)).join();
      if(view!==this.lastLabelView){this.lastLabelView=view;this.onPositions(this.getPositions());}
    }
    this.frame=requestAnimationFrame(this.loop);
  }
  refreshLabels(){this.lastLabelView=null;this.lastLabelAt=-1;}
  recenter(){
    this.camera.position.copy(CAM_POS);
    this.controls.target.copy(CAM_TARGET);
    this.controls.update();
  }
  resize(){
    const w=Math.max(1,this.container.clientWidth),h=Math.max(1,this.container.clientHeight);
    this.camera.aspect=w/h;
    // Portrait-ish center pane: widen FOV so the whole rock bed stays visible.
    this.camera.fov= h/w > 1.3 ? 44:37;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w,h,false);
  }
  destroy(){
    this.disposed=true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown',this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup',this.onPointerUp);
    this.controls.dispose();
    const geo=new Set(), mats=new Set();
    this.scene.traverse(o=>{
      if(o.geometry)geo.add(o.geometry);
      if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>mats.add(m));
    });
    Object.values(this.flowMats).forEach(m=>mats.add(m));
    geo.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());
    this.renderer.dispose();this.renderer.domElement.remove();
  }
}

