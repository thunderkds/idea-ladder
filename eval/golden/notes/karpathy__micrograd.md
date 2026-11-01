# karpathy/micrograd @ 7bc720e951fe422b8f8814aa5aa1b64121d26b4c

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `micrograd/engine.py`: the scalar Value class with autograd and backward
- `micrograd/nn.py`: Neuron, Layer and MLP built on Value
- `test/test_engine.py`: checks gradients against PyTorch

## Concepts

- automatic differentiation
- backpropagation
- computation graph
- neural network
- gradient descent
