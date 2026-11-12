# kjd/idna

- Pinned SHA: `d357725082245ff90f5cf8800a3fc297b1f2319a`
- Tier: lowkey · Language: Python · Expected confidence: medium
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `idna/core.py` — encode/decode, alabel/ulabel, label checks (bidi, contextj, contexto, hyphen) and the UTS46 remap.
- `idna/codec.py` — Codec registered with the codecs module so str.encode('idna2008') style calls work.
- `idna/idnadata.py` — Unicode property tables used by the label checks.
- `idna/intranges.py` — Compact integer-range encoding used to store those tables.
- `idna/compat.py` — Compatibility wrappers ToASCII, ToUnicode and nameprep.

## Concepts

- internationalized domain names
- punycode a labels and u labels
- uts46 mapping
- label validation
- codec registration

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
