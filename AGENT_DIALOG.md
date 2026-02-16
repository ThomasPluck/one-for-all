# Agent Dialog

## TASK 2 Agent
**Status**: COMPLETE
**Task**: Doc 06, Task 2 — Externalized Ports (rhombus objects colored by metallization layer)

### Files I'm modifying:
- `src/canvas/types.ts` — new OfaExternalPort interface, union type expansions
- `src/types.ts` — mirror type changes
- `src/canvas/state.ts` — externalPortMode, getSelectedExternalPort, btnExtPortMode DOM ref
- `src/canvas/geometry.ts` — resolveAnchorPosition expansion
- `src/canvas/messages.ts` — backfill + selection persistence
- `src/canvas/rendering.ts` — drawExternalPorts, selection highlight
- `src/canvas/hitTest.ts` — hitTestExternalPort
- `src/canvas/input.ts` — E key, placement, selection, drag, wire connectivity, delete, right-click
- `src/canvas/junctions.ts` — deleteExternalPortCascade, isJunctionPinned update
- `src/canvas/overlays.ts` — showExternalPortOverlay
- `src/canvas/OfaEditorProvider.ts` — toolbar button HTML

---

## TASK 1 Agent
**Status**: COMPLETE
**Task**: Doc 06, Task 1 — Subcell Inclusion (include other .ofa files as movable blocks)

### Files I'm modifying:
- `src/canvas/types.ts` — extend OfaInclude with flipH/flipV/_cache, add IncludeGeometry, update SelectionState
- `src/canvas/state.ts` — includeSelect DOM ref, includeGeometryCache, getSelectedInclude()
- `src/canvas/geometry.ts` — resolveAnchorInDoc() for nested geometry
- `src/canvas/rendering.ts` — drawIncludes(), drawIncludeContents(), selection highlight
- `src/canvas/hitTest.ts` — hitTestInclude(), cursor update
- `src/canvas/input.ts` — placement, selection, drag, right-click, delete, rotation/flip for includes
- `src/canvas/junctions.ts` — deleteIncludeCascade()
- `src/canvas/overlays.ts` — showIncludeOverlay() with "Open .ofa" button
- `src/canvas/messages.ts` — backfill, includeGeometryResult + includeList handlers
- `src/canvas/OfaEditorProvider.ts` — toolbar HTML, queryIncludeGeometry/openIncludeFile/includeList handlers, file watcher

---

## TASK 3 Agent
**Status**: COMPLETE
**Task**: Doc 06, Task 3 — Design Hierarchy Tree in Sidebar

### Shared contract: OfaInclude type
All agents use `OfaDocument.includes?: OfaInclude[]` where `OfaInclude.file` is a relative path from the including file's directory.

### Files I modified:
- `src/types.ts` — added `OfaInclude` interface, `includes?` field on `OfaDocument`
- `src/canvas/types.ts` — added `OfaInclude` interface, `includes?` field on `DocumentData`
- `src/hierarchy.ts` — **NEW** — `buildDependencyMap()` + `buildHierarchyTree()` for sidebar tree
- `src/SidebarProvider.ts` — replaced flat file list with recursive tree, added `openSchematic` handler, added `FileSystemWatcher` with debounce
- `media/sidebar.css` — added `.tree-root`, `.tree-row`, `.tree-toggle`, `.tree-icon`, `.tree-label`, `.tree-children` styles

### No conflicts with Task 2:
- Task 3 does not touch any `src/canvas/*` files (except `types.ts` which is shared)
- Task 2's `"externalPort"` union additions don't conflict with Task 3's `OfaInclude` additions
