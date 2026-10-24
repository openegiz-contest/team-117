# Input provenance

All geometry, volumes, resistances, fan ratings, sensor assignments, initial
concentrations and source rates are **fictional design assumptions** of DeepCore
Labs. No operating-mine dataset, confidential data or personal data is used.
Both versioned input files (`data/mine_topology.json`,
`data/model_parameters.json`) carry an `assumption_source` statement. Ditto
twins carry it as an attribute, and every published value carries
`source_type: SYNTHETIC_PHYSICS`.

| Input | Value | Basis |
|---|---|---|
| Methane thresholds | 0.5 / 1.0 / 1.5 % vol, 0.1 % downgrade hysteresis | 1.0 % and 1.5 % mirror the action tiers of US 30 CFR 75.323(b) (de-energize and adjust ventilation at 1.0 %; withdraw persons and disconnect power at 1.5 %). Demonstration only, not a compliance claim |
| CO thresholds | 25 / 35 / 50 ppm, 5 ppm hysteresis | 35 ppm NIOSH REL, 50 ppm OSHA PEL (NIOSH Pocket Guide); 25 ppm early advisory |
| Minimum zone airflow | 5 m³/s | demonstration constraint |
| Stale-data timeout | 5 s | demonstration constraint |
| Zone volumes | 1,200–3,600 m³ | roadway cross-section 10–15 m² × airway length 200–320 m |
| Airway resistances | 0.12–0.30 N·s²/m⁸ | chosen for a baseline split of ≈15 m³/s (heading) and ≈25 m³/s (face) |
| Main fan | 160 kW, 980 rpm, 2,500 Pa shut-off, K = 0.5 | exhausting fan on a 6-pole 50 Hz motor (≈1000 rpm synchronous) |
| Auxiliary fan | 22 kW, 1,450 rpm, 180 Pa shut-off, K = 0.7 | heading booster on a 4-pole 50 Hz motor (≈1500 rpm synchronous) |
| Initial fan speeds | main 75 %, auxiliary 50 % | gives ≈39.6 m³/s section airflow, ≈3 m/s in a 12–15 m² roadway |
| Inlet air | 0.002 % CH₄, 2 ppm CO | clean intake air |
| Methane sources | Z03 0.008, Z04 0.040, Z05 0.002 m³/s | baseline face methane ≈ 0.04 / 24.7 ≈ 0.16 % |
| CO sources | Z03 0.00005, Z04 0.00012 m³/s | equipment exhaust at the working places |
| S1 release | Z04 0.8 m³/s for 180 s | sudden release that crosses all methane tiers in under a minute |
| S2 failure | main fan faulted at 10 s for 90 s | loss of main ventilation |
| VOD | candidate speeds 40–100 %, ±20 % step, 60 s horizon, 0.05 kWh switching penalty per unit change | demonstration controller settings |
| Physics tick | 0.5 s, CFL bound 0.5 | numerical stability; residual is reported |

Rounding at the Ditto interface: methane % volume to 8 decimals, CO ppm to 8
decimals, fan speed % and RPM to 6 decimals. The runtime unit check confirms
the round trip stays within 1e-9 (fraction).
