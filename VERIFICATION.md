# Release verification

Verified October 27, 2026 for the published 0.1.0 preview.

The direct GitHub launcher was cloned from the public repository. Its automatic installer downloaded the release engine and pinned dependencies into a fresh temporary application home.

| Platform | Payload files verified | Engine tools | Installation discovery |
| --- | ---: | ---: | --- |
| Windows x64, Node 24 | 20,104 | 19 | Passed |
| Linux x64, Node 24 | 20,094 | 19 | Passed |

Both processes exited successfully and removed their temporary installations. Existing connections and device identities were unchanged. These tests created no remote tunnel or API key.

Earlier isolated bootstrap tests also passed local profile creation, native loopback proxy file operations, and credential isolation.

A separate newly enrolled PC still requires its own OpenAI tunnel, runtime key, ChatGPT plugin association, and end-to-end verification through that plugin. New portable connections run in the foreground; keep that terminal open. Existing managed installations can reconnect through their previously configured background service or task.

Supported preview targets are Windows x64 and Linux x64 with Node.js 24. The GitHub shorthand additionally requires Git. macOS, ARM, portable autostart, and automatic upgrades are not yet claimed.