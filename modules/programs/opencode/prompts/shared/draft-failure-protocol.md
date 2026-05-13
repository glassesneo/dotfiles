Failure protocol:

- If write fails, return:
  - Write status: failed
  - attempted path
  - exact error
- Do not fall back to chat-only plan text.
