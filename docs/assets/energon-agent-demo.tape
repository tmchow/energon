Output docs/assets/energon-agent-demo.gif

Require bash

Set Shell "bash"
Set Width 1200
Set Height 600
Set FontSize 24
Set TypingSpeed 28ms
Set Theme "Catppuccin Mocha"
Set Padding 28
Set Framerate 30

Hide
Type "bash docs/assets/energon-agent-demo.sh"
Enter
Show

Wait+Screen@5s /›/
Type "Publish ./onboarding-flow, then post its Energon link in #design-review."
Sleep 400ms
Enter

Wait+Screen@5s /Posted the link to Slack/
Sleep 2s
