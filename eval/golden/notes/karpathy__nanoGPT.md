# karpathy/nanoGPT @ 3adf61e154c3fe3fca428ad6bc3818b27a3b8291

Confidence 0.7 (high): 0 good first issue (-0.1); no dependency file (-0.2).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `model.py`: the GPT model definition: attention, blocks, loading GPT-2 weights
- `train.py`: the training loop
- `sample.py`: text generation from a trained model
- `configurator.py`: how config files override the training script's globals
- `data/shakespeare_char/prepare.py`: builds the character-level dataset used in the quick-start

## Concepts

- transformer
- causal self-attention
- language modeling
- training loop
- finetuning
- tokenization
