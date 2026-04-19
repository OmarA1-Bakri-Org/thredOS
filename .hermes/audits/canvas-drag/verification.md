# Canvas node drag — verification

## OBSERVED
- xyflow emits CSS class `draggable` on `.react-flow__node` elements
- Programmatic mouse drag (down, move, move, move, up) moved node
  transform from `translate(12px, 12px)` → `translate(209.449px, 99.7551px)`
- DOM bounding rect: (439, 367) → (619, 447)
- Dependency edges re-routed automatically
- Attached detail cards follow node position by construction
- Full gate (bun run check) parity with origin/main preserved

## Test
`agent-browser mouse down/move/up` on a StepNode, see
`canvas-after-drag.png` for the resulting state.
