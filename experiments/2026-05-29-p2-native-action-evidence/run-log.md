# P2 Native Action Evidence Run Log

- Branch: main after fast-forward merge of codex/native-action-evidence-closure.
- Task: settings-toggle.
- Local benchmark URL: http://127.0.0.1:4173/?task=settings-toggle.
- Source: UI-TARS exposed renderer state via window.zustandBridge.getState(); no UI-TARS private storage read.
- Outcome: user_stopped after repeated timezone dropdown clicks.
- Final benchmark capture: score 0.75, success false.
- Failed criteria: timezone is America/New_York.
