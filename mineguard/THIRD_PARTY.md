# Third-party software and assets

MineGuard X preserves the licenses and notices shipped with OpenEgiz. The
extension uses these package ecosystems through locked dependency manifests:

- Eclipse Ditto and the official OpenEgiz services, under their repository
  licenses and notices.
- Python packages listed with versions and hashes in
  `backend/requirements*.txt`.
- React, React DOM, React Router, Vite, TypeScript, ESLint, Vitest, Testing
  Library, and their locked transitive packages in `frontend/package-lock.json`.
- Three.js (MIT), React Three Fiber (MIT), and Drei (MIT) render the procedural
  mine. Recharts (MIT) renders telemetry charts; Tailwind CSS (MIT) supplies CSS
  tooling. Lucide React icons use the ISC license. Preserve the notices in the
  installed dependency distributions when redistributing them.
- Official Docker images named in the upstream Compose file and MineGuard
  Dockerfiles.

The MineGuard UI uses Lucide package icons and code-generated SVG/WebGL
geometry. Tunnel supports, rock meshes, ducts, fans, and equipment props are
procedural illustrations, not downloaded mine assets or surveyed geology.
No industrial measurement or proprietary dataset is included. Browser evidence
images are captures of this application. Dependency licenses are declared in
the lockfile/package distributions; this notice is not a legal license audit.
