---
name: verify-media-job-lease
description: Model-check the hosted media dispatcher, lease, and retry path.
---

Follow `.cursor/skills/verify-media-job-lease/SKILL.md`. Run:

```bash
bash .cursor/skills/verify-media-job-lease/spec/run-tlc.sh
```

Do not change product code. Do not treat exit 0 as a mutual-exclusion pass. Report the recorded result in plain steps: pass or counterexample, the bounds, what the model leaves out, and the head SHA. If the real model violates a property, quote the trace and the code location, and do not fix it.
