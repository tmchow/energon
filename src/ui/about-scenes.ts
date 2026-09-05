export const scenes = [
  {
    "id": "prototype",
    "n": "01",
    "title": "Open a working prototype",
    "paragraphs": [
      "Upload a prepared HTML folder or ZIP, or ask your agent to publish it. With an <code>index.html</code>, the link opens the actual site and its assets, ready to explore in a browser.",
      "Open it yourself or send the link to someone else. If your prototype needs a build step, build it before uploading; Energon serves the output and does not run server-side code."
    ],
    "caption": "Less ceremony. The folder becomes a link."
  },
  {
    "id": "handoff",
    "n": "02",
    "title": "Read now. Reference later.",
    "paragraphs": [
      "A Markdown brief opens as a readable page. Give its link to your agent tomorrow, or to another agent on a different machine, to read as reference for the next task. Reading does not require permission to edit.",
      "The same work is readable by people and retrievable as files by agents. For Markdown source, use <code>?raw=1</code>. An agent can also use the authenticated file URL with its own token from this instance."
    ],
    "caption": "One session publishes. Another reads or references the work."
  },
  {
    "id": "pong",
    "n": "03",
    "title": "Revise the work. Keep the link.",
    "paragraphs": [
      "Read a plan, ask your agent for a change, then reopen the same link. The creator chooses whether only their account or other authorized users and agents on this instance may update or delete the work.",
      "There is no editor here: people edit in their own tools or through agents, which replace the underlying file. Last write wins. The link shows current contents, without comments, merges, or revision history. Keep work that needs reviewed history in your repository."
    ],
    "caption": "Take a turn. Same link. Last write wins."
  },
  {
    "id": "living",
    "n": "04",
    "title": "Continue here, or make a copy",
    "paragraphs": [
      "Updates keep the same address until the work expires or is deleted. Replacing contents does not extend expiration. A stable link is a reference to current work, not a frozen revision.",
      "To explore another direction, a signed-in user or an agent with an instance token can duplicate a file or site. The copy has its own link, owner, and settings; it does not inherit the original's password. Choose its write policy and expiration for the new purpose."
    ],
    "caption": "Updates keep the address until expiry or deletion."
  },
  {
    "id": "public",
    "n": "05",
    "title": "Links are open by default",
    "paragraphs": [
      "You sign in to upload, or give your agent a token. Recipients need no company login to open published links. Add a share password when the public link needs a gate.",
      "A share password does not restrict reads through the API: any valid token on this instance can still read the underlying work. If you need access limited to named recipients, use a system with per-reader permissions."
    ],
    "caption": "Sign in to publish. Links are open by default, with optional passwords."
  }
];
