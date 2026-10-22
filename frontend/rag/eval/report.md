# RAG retrieval evaluation

Corpus: 78 chunks from 16 documents and 48 cited sources · embeddings: gemini-embedding-001 (768 dims) · index: IndexFlatIP, faiss 1.15.1 · built 2026-10-22T06:39:52+00:00

Test set: 62 athlete questions with hand-labelled relevant chunks, plus 6 off-topic questions that should retrieve nothing (rag/eval/questions.json). The coach receives the top 4 passages (at most 2 per document).

| Method | Hit@1 | Hit@4 | Recall@4 | MRR | Passages from the right topic | Off-topic questions correctly answered with no passages |
|---|---|---|---|---|---|---|
| keyword | 71.0% | 82.3% | 72.8% | 0.763 | 47.0% | 66.7% |
| vector | 95.2% | 98.4% | 92.2% | 0.968 | 78.3% | 100.0% |
| hybrid | 90.3% | 98.4% | 90.6% | 0.938 | 79.0% | 100.0% |

- **Hit@1 / Hit@4**: share of questions where a relevant chunk is ranked first / appears in the 4 passages sent to the coach.
- **Recall@4**: share of the relevant chunks that were retrieved (capped at 4).
- **MRR**: mean reciprocal rank of the first relevant chunk.
- **Passages from the right topic**: share of returned passages that come from the same document as a labelled answer (a precision proxy).
- **Off-topic**: share of unrelated questions (cricket, coding, movies...) for which nothing was retrieved, so the coach is not fed irrelevant text.

Settings: minCosine 0.53, dropBelowTop 0.06, RRF k 60, keyword weight 1, candidate pool 20, keyword-only minimum BM25 4.

## Misses
- **keyword** missed: "how much protein should I take after an intense gym workout" → got nothing
- **keyword** missed: "how many grams of protein per day for a runner" → got `indian-foods#cheap-protein-for-hostel-budget-and-travel`
- **keyword** missed: "is it bad to avoid ghee and oil completely" → got nothing
- **keyword** missed: "how do I know how much I sweat" → got nothing
- **keyword** missed: "it is 38 degrees here in May, how should I train" → got `sleep-and-cycle#training-and-the-menstrual-cycle`, `under-fuelling-reds#warning-signs-of-under-fuelling`
- **keyword** missed: "my teammate became confused and collapsed during a hot run, what to do" → got `heat-and-cramps#planning-runs-on-hot-days`, `fuel-during-runs#how-much-carbohydrate-to-take-per-hour-during-a-run`
- **keyword** missed: "I want to lose weight fast by eating very little while training for a marathon" → got `carbs-and-energy#carbohydrate-loading-before-a-long-race`, `foot-strike#most-distance-runners-land-on-the-heel`
- **keyword** missed: "do I need a vitamin D tablet" → got nothing
- **keyword** missed: "should every run be fast" → got `training-load-injury#how-fast-to-increase-weekly-running`, `running-drills#drills-for-quicker-steps-and-a-better-landing`
- **keyword** missed: "back of my heel hurts in the morning" → got `foot-strike#most-distance-runners-land-on-the-heel`, `foot-strike#heel-striking-and-injury-in-one-college-team`
- **keyword** missed: "how do I change my running technique without getting hurt" → got `heat-and-cramps#getting-used-to-running-in-the-heat-acclimatisation`, `hips-knees-symmetry#strength-alone-may-not-change-running-form`
- **vector** missed: "should I drink tea right after lunch" → got `hydration#drinking-after-training`, `hydration#checking-hydration-with-urine-colour`
- **hybrid** missed: "is it bad to avoid ghee and oil completely" → got `indian-foods#a-balanced-indian-plate-for-an-athlete`, `under-fuelling-reds#energy-availability-and-how-to-avoid-under-fuelling`
