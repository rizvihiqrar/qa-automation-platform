# The practical: find the planted bugs

Ungraded. About 45 minutes. Nobody sees your answers, and there is no score: you check yourself against a checklist and a model answer, and the feedback is in those.

## The task

A copy of the banking API is running with **six bugs planted, one for each objective**. You are not told what they are or where. Test it from the outside, with requests and answers, as you did in the labs, and find as many as you can.

```bash
cd packages/money-course && npm install && npm run practical
```

It listens on http://localhost:4200, keeps everything in memory (restart for a clean ledger), and makes each request wait 150 ms in a pretend outside check, so overlapping requests really overlap.

You can use curl, Postman, a browser, or a few lines of Node. You do not need to read the code, and the code does not say where the bugs are.

## How to work

1. Open [checklist.md](checklist.md) next to you. It lists the behaviours worth checking, one for each objective, without saying which one is broken.
2. For each, decide what the API **should** answer (use the modules), send the requests, and write down what it **did** answer.
3. Where they differ, you have found a bug. Write one line: what you sent, what you expected, what came back.
4. When you have finished or are stuck (stop at 45 minutes either way), open [model-answer.md](model-answer.md) and compare. For each bug there is how to find it, what you should have seen, and which objective it belongs to.

## What it is not

It is not a test of you. A bug you missed tells you which objective to go back to, and the quiz's "after" mode and the retention check show whether it stuck. If you find a seventh problem that is not in the model answer, tell the person running the pilot: the practical is a pilot too.
