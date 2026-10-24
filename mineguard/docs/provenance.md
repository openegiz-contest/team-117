# Input provenance — M1/M2

All geometry, zone volumes, depths, coordinates, airway resistances, fan ratings,
sensor assignments, initial concentrations and source rates are fictional
DeepCore Labs demonstration assumptions. No operating-mine dataset was used.
The versioned JSON files carry this provenance explicitly.

| Input | Meaning and assumption |
|---|---|
| Zone volumes, 1200–3600 m3 | Distinct fixed well-mixed control volumes; uncalibrated |
| Airway lengths, 200–320 m | Schematic engineering metadata; not used as calibrated transport delays |
| Nominal flow, 40 m3/s total | A prescribed balanced M1 flow allocation; branches 12 and 28 m3/s |
| Resistances, 0.12–0.30 Pa s2/m6 | Fictional quadratic M2 airway coefficients; uncalibrated |
| Main fan curve | 2500 Pa shutoff, 0.5 Pa s2/m6 curve coefficient, 160 kW rated; fictional |
| Auxiliary fan curve | 180 Pa shutoff, 0.7 Pa s2/m6 curve coefficient, 22 kW rated; fictional |
| Initial fan commands | Main 0.75, auxiliary 0.50; scenario starting assumptions |
| Inlet methane fraction, 0.00002 | Explicit fictional boundary value (0.002% = 20 ppm) |
| Methane source at Z03/Z04/Z05 | 0.008/0.040/0.002 m3/s at the common reference conditions |
| Other methane source rates | Explicit zero source assumption, not missing sensor data |
| Initial zone concentrations | Configured transient starting state, not measured equilibrium |
| Simulation tick | 0.5 s; default transport stability bound 0.5 |

No safety thresholds, compliance claim, measured mine performance, dataset
license assumption or certified fan curve is implied. M2 uses these parameters
only in its documented quasi-steady demonstration equations. The successful
integration run proves software transport through OpenEgiz; it does not validate
physical accuracy. Dataset integration, if added later, requires
source/license/unit/site-mapping inspection first.
