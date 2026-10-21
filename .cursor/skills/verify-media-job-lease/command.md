---
name: verify-media-job-lease
description: Model-check the hosted media dispatcher, lease, and retry path.
---

Follow `.cursor/skills/verify-media-job-lease/SKILL.md`. Run:

```bash
bash .cursor/skills/verify-media-job-lease/spec/run-tlc.sh
```

Do not change product code. Exit 0 means mutual exclusion passes, termination passes, and both mutants are caught. Report that result in plain steps, the bounds, what the model leaves out, and the head SHA. If the real model violates a property, quote the trace and the code location, and do not fix it.
