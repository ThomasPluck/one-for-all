# OFA Roadmap

## Phase 0: Core Editor

1. [x] Device placement and editing w/ GDSII
2. [ ] Multi-layer wire and junction drawing and editing w/ GDSII
   - Net connectivity graph tracking from day one
3. [ ] Hierarchical schematic design w/ GDSII
4. [x] Clean cell generation API boundary (internal API suitable for future scripting surface)
5. [ ] SPICE netlist generation + net labelling w/ DC/AC/Transient sims
6. [ ] Anti-regression test suite: geometric primitive tests, GDSII golden file tests, wire editor invariant tests
7. [ ] Speedy non-clunky UX
8. [ ] .ofa format spec documented

## Phase 1: Low-Frequency Analog Demo

1. [ ] Minimal DRC — show violations as you draw (basic spacing)
2. [x] PDK layer stack and material property ingestion
3. [ ] Specification DRC — foundry rule deck violations as you draw
4. [ ] DRC enforcement policies: flag / autoreject / hint (per priority tier)
5. [ ] Rule-based PEX — get RC estimates as you draw (Magic-style)
6. [ ] Back-annotate SPICE with rule-based PEX
7. [ ] Quasi-static field extraction (FastCap/FastHenry) replacing rule-based estimates
8. [ ] Back-annotate SPICE with field-extracted parasitics
9. [ ] User-facing procedural generation scripting surface

## Phase 2: Radio-Frequency Demo

1. [ ] Layer stack to 3D geometry conversion
2. [ ] Port and monitor definition
3. [ ] FDTD simulation orchestration (openEMS/Meep)
4. [ ] S-parameter extraction
5. [ ] Back-annotation of S-parameters into editor

## Phase 3: Future

1. [ ] 2.5D MoM extraction (FOSS or integration with commercial)
2. [ ] Import/export beyond GDSII (existing GDSFactory designs, netlist formats)
3. [ ] Photonics demo pathway (waveguide in OFA → GDSII → Meep, for GDSFactory community visibility)