Output docs/demo/energon-machine-handoff-demo/assets/local-terminal.mp4

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
Type "bash docs/assets/energon-machine-handoff-demo.sh local"
Enter
Show

Wait+Screen@5s /›/
Type "Zip ./spring-launch and share it through Energon for my cloud workspace."
Sleep 350ms
Enter

Wait+Screen@6s /Ready for cloud handoff/
Sleep 3.2s
