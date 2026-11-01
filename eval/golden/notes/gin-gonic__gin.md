# gin-gonic/gin @ 0f09c3a9b4626d9fe9979cf4d0521d6ae32ab646

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `gin.go`: the Engine: routes, handler chain and ServeHTTP
- `context.go`: the per-request Context with binding and rendering helpers
- `routergroup.go`: route groups and middleware attachment
- `tree.go`: the radix tree that matches request paths
- `recovery.go`: panic recovery middleware
- `binding/binding.go`: request body and query binding interface

## Concepts

- radix tree router
- middleware chain
- request context
- route groups
- data binding
- response rendering
