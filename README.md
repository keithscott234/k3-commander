# K3 Commander

Local file, search, and terminal tools connected through a private OpenAI tunnel.

## Supported preview

Windows x64 and Linux x64 with Node.js 24. Extraction requires tar; Linux also requires unzip. Other platforms, automatic upgrades, and automatic startup for new portable installations are not yet verified.

After the package and engine releases are published:

    npx @t3forgeworks/k3-commander@latest remote

The command discovers an existing managed connection or installs a matching verified engine in your user account. A new device needs its own OpenAI tunnel and runtime key. Follow the terminal prompts using:

- https://platform.openai.com/settings/organization/tunnels
- https://platform.openai.com/settings/organization/api-keys

Use a dedicated runtime key with Tunnels Read and Use. Enter the key only in the hidden local prompt, or supply CONTROL_PLANE_API_KEY in the local environment. The prompt keeps it in memory for that run and does not save it. Keep the terminal open while using the foreground connection.

Enable the corresponding private ChatGPT plugin after the tunnel is running. Account-side enrollment and plugin association are separate from local engine readiness.

## Local commands

    k3-commander remote --check
    k3-commander locate
    k3-commander pair --tunnel-id YOUR_DEVICE_TUNNEL_ID
    k3-commander install --source ABSOLUTE_EXTRACTED_DIRECTORY --sha256 TRUSTED_MANIFEST_SHA256

The check command never starts setup or a connection. Obtain trusted hashes from the release source; a hash calculated from an untrusted download does not authenticate it.

Default installation homes are %LOCALAPPDATA%/K3Commander on Windows and ~/.local/share/k3-commander-portable on Linux. K3_COMMANDER_HOME can specify an absolute alternative owned by your account. Do not use a shared writable directory.

Dependencies are pinned and checked before extraction. Installation verifies payload files before and after staging and tests the engine before registering it. Existing installations and device identities are not overwritten. Inspect stale locks after an interrupted process before removing them.

Engine child processes do not inherit OpenAI or control-plane credentials. Existing managed connections remain supported. Desktop Commander hosted usage is not used by this local engine; separate ChatGPT and OpenAI account limits still apply.

Includes MIT-licensed DesktopCommanderMCP components. See UPSTREAM-LICENSE.txt and upstream.json for attribution and pinned upstream information.
