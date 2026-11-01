# pmndrs/zustand @ 382d29c485e67018c06e75ec7235130d0968522c

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `src/vanilla.ts`: the store core: state, setState, subscribe, no React
- `src/react.ts`: the React hook that binds a store to components
- `src/middleware/persist.ts`: the persistence middleware
- `src/middleware/immer.ts`: the immer middleware for draft updates
- `src/shallow.ts`: shallow equality used to avoid re-renders

## Concepts

- store
- selector
- middleware
- subscription
- persistence
- react hook
