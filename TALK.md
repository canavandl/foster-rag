# Foster RAG — 3-Minute Technical Walk-Through

---

## Hook & Use Case

My wife and I became foster parents last year. It's been a great experience, but one of the challenges is that there are a huge number of state regulations that we need to follow related to things like our home and visitors, and the child's health and education. Texas foster care regulations are spread across dozens of PDFs — primarily the CPS Policy Handbook and various official Resource Guides — and I'd hate to be out of compliance due to a hallucinated LLM response. Fortunately - this is the kind of problem that retrieval augmented systems are good at, where I can ask natural language questions about regulations and get accurate answers backed by citations to the actual regulatory text.

---

## Tech Stack

*[Show Flow Chart in README.md]*

The entire stack runs on Cloudflare's edge platform. The document ingestion and query endpoints are implemented in TypeScript using the Hono framework and deployed to a Worker.

The /upload endpoint uses Workers AI to generate embeddings from each text chunk and stores the embeddings in Vectorize and the chunks themselves in D1.

Then the /query endpoint also uses the same embedding model to generate a query embedding that's used to find the top-K most similar chunks in Vectorize. The returned chunk IDs are used to fetch the associated text chunks from D1. The endpoint logic then injects the text chunks as context into the prompt that's fed to the Llama model made available via Workers AI to generate the answer.

The frontend is served directly from the Worker rather than a CDN — fine for a prototype, but in production you'd typically split static assets onto Cloudflare Pages, which would also give you rate limiting to control LLM inference costs and access controls to restrict who can use the tool.

---

## Demo

*[Show [TxFoster RegRAG](https://foster-care-rag.canavandl-cloudflare.workers.dev/)]*

Let me show it in action. I'll ask about something that I had to look up last weekend.

*[Run query: "My foster child fell off her bike and bit her lip. Do I need to inform CPS of the accident?"]*

Notice the question isn't phrased like a regulation lookup or keyword search. There's no mention of "incident reporting requirements" or policy section numbers. The embedding model handles the semantic matching, so the question can be conversational.

*[Answer appears]*

And there's the answer, with citations linking directly to the relevant sections of the CPS Policy Handbook.

---

## Interesting Challenge

One design decision worth calling out is the document store. AWS Bedrock Knowledge Bases — Amazon's managed RAG service — defaults to OpenSearch Serverless for storing both document chunks and embeddings. OpenSearch offers richer query features like fuzzy matching and hybrid search, but it's significantly more expensive than what I'm using here. By separating the vector index (Vectorize) from the document store (D1), I get a serverless SQLite database for chunk retrieval at essentially zero cost — the only queries it handles are primary key lookups by chunk ID, which D1 is perfectly suited for. If I were building a production version with higher query volume or a need for hybrid search, that tradeoff would be worth revisiting.

---

## Closing

The code is open source at github.com/canavandl/foster-rag
