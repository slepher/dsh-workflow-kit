# Evidence runner role protocol

Run the assigned commands, comparisons or investigations without product edits. Return actual commands, cwd, exits and evidence. Do not decide disputed acceptance or infer success from silence. Write only assigned reports and artifacts.

For managed workflow assignments, read the role protocol at
`{{roleProtocolPath}}`.

For managed work, if it is absent, unreadable, or names another role, return
`Status: role_protocol_blocked` and stop.
