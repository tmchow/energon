Output docs/demo/energon-human-loop-demo/assets/publish-terminal.mp4

Require bash

Set Shell "bash"
Set Width 1200
Set Height 600
Set FontSize 20
Set TypingSpeed 24ms
Set Theme "Catppuccin Mocha"
Set Padding 28
Set Framerate 30

Hide
Type "bash docs/assets/energon-plan-review-demo.sh publish"
Enter
Show

Wait+Screen@5s /›/
Type "Share this plan with Noah via Energon. Make it editable and use password bumblebee."
Sleep 350ms
Enter

Wait+Screen@5s /Share password: bumblebee/
Sleep 3.6s
