# Portable background startup

This feature is opt-in and applies only to a paired portable installation. Existing Windows reconnect tasks and the existing Linux managed service retain their normal remote-command precedence.

After installing and pairing a portable device, run:

```text
k3-commander background enable
k3-commander background status
k3-commander background stop
k3-commander background reconnect
k3-commander background disable
```

Use the same launcher prefix used for remote (for example, npx.cmd -y github:keithscott234/k3-commander) with launcher version 0.1.2 or later.

Enable saves a runtime key from the local environment or a hidden terminal prompt, registers startup, and requests a connection. It never creates a tunnel or changes the device identity. Stop pauses startup as well as stopping the process. Reconnect resumes startup and requests a connection. Disable removes the background task/service, its copied launcher, and its saved credential; the engine and pairing remain.

Windows uses a limited, interactive per-user Task Scheduler task at sign-in. The key is encrypted with Windows user-bound DPAPI. Linux uses a systemd user service and stores its key unencrypted in a 0600 user-owned file inside a 0700 directory. Linux startup follows the user manager's lifetime; this feature does not enable lingering or promise startup before sign-in. A stable Node executable must remain at the path used during enable.

Each installation has a unique task/service name derived from its absolute home. K3_COMMANDER_HOME selects an isolated installation. Native tunnel output is suppressed so it cannot leak credentials into task logs. Status reports OS state and the last runner observation; it does not claim tunnel health or ChatGPT connectivity. Confirm that with a read-only plugin call.

The runner retries child failures with a delay capped at 30 seconds. A connection lock prevents competing foreground/background processes. Recovery only reclaims a known background lock when both recorded owner and child are gone. Unknown locks, a live PID, PID reuse, malformed records, or a leftover lock guard fail closed for local inspection. No process is killed based on an old lock record.

No real credential, existing production task/service, or existing device profile is changed by the automated tests. The explicitly invoked test/background-os.integration.mjs creates and removes one isolated OS task/service with a synthetic child. Full sign-in/reboot and enrollment on a separate physical PC remain acceptance checks, not verified results.
