# Demo script

Read this in your own voice. About four minutes. Have the app open at the First Break page, with `OTARI_API_KEY` set if you want the Otari lines to show real request ids. Do not add an AI voiceover.

Start on the First Break page. Do not introduce yourself by name unless you want to. Start with the product.

---

First Break checks a page the way a stranger would, and it stops at the first place they get stuck. I paste a URL, a how-to, or both. It does one loop. It reads the page in screen-reader order, tries the steps, and rewrites only the step where a new person would stop.

The model calls go through hosted Otari, not a model provider I call myself, and not a copy of Otari I run. The key stays on the server.

I am using the broken page that ships with the repo, so this does not depend on some other site staying up. I’ll open it first.

Open `/fixture/broken.html` in a new tab. Point at the heading “Saturday workshop”, then “What to bring”, then the email field, the arrow button, and “Notify me”.

The title is a level one heading. The next heading, “What to bring”, is level three. That skips a level. The arrow button has an icon and no name. “Notify me” is a real label, and it is the wrong action for the steps I’m about to give.

Back on First Break, click “Load the broken demo”.

The URL is this app’s fixture. The how-to has three steps. Open the page. Enter your email. Click “Reserve my seat”. That button does not exist.

Click “Find the first break”.

The reading order is the first result. A screen reader meets the document title, the level one heading, then the level three heading, then Email, then a button with no name, then “Notify me”. The skip and the missing name are flagged from the tree the parser built. They are not guesses.

That tree was built by Otari code execution. The server sends a Python script to `POST /api/v1/code/execute`. The script uses only the Python standard library, because the sandbox does not install packages. If that call fails, the same script runs locally, and the panel says so. It does not pretend the sandbox ran.

The narration above the list is a different model from the one that judges the steps. Narration is Qwen three, thirty-two billion, catalog id `alibaba/qwen3-32b`. If that call fails before any answer, the client asks Gemma three, twenty-seven B. The attempt, the part that decides where the stranger stops, is Llama three point three, seventy B. Its fallback is Mistral Small three point two. All four are open-weight. The strip at the bottom shows which one Otari actually served, and whether Otari’s own fallback header was true.

Point at the attempt.

Step one and step two can be done. The page is open, and the email field is named Email. Step three is the break. Nothing in the reading order is named “Reserve my seat”.

The rewrite is one step. It says the name is not on the page, and it points at the unlabeled button by its place in the tree. It does not rename that button, and it does not tell you to click “Notify me” instead. If the model drafts a new name, or a button that is not in the tree, the app holds that draft and keeps the sentence that only uses the tree. Those are the app rules, next to Otari’s own guardrail.

Point at the Otari panel.

Every chat request sends a guardrail entry, profile `prompt-injection`, in monitor mode. The `Otari-Guardrails` header is shown raw. If this workspace has not mandated a guardrail service, the header can say the check was unavailable. That is an honest result, not a silent skip. I can turn the same profile to block in the dashboard once it is configured.

Fetch is on this panel too. This run says the fixture was read locally. Otari refuses loopback and private addresses, so I do not send this URL to `POST /api/v1/fetch`. A public URL does go there, with the built-in fetch tool. If the how-to names a site or a product and I do not paste a URL, the app calls `POST /api/v1/search`. It only fetches a result whose host is a domain the steps already named. It will not open a random hit.

Budgets: before and after the run, the server reads `GET /api/v1/key/budget`. The session id in the form is sent as the end-user tag. With a service key, Otari also tracks that person against an end-user budget. This browser’s spend is the sum of the `cost_usd` fields Otari returned, and there is a small ceiling so one session cannot keep going. Request ids appear here only when Otari returned them.

MCP stays “not configured” unless I give Otari a public https server. I only say a tool ran when this line says Otari returned the call.

That is the whole product. One stranger, one page, the first place they stop.

Thanks for watching.
