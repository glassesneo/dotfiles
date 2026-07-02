Use `prompt-interface-design` to pass only the target/context below to the `spec` subagent; after each returned spec, briefly explain it and ask the user to confirm or revise, repeating revision delegation until confirmed or until the user stops, and never replace failed artifact creation with a chat-only spec.

Spec target: $ARGUMENTS
