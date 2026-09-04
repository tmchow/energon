Output docs/demo/energon-human-loop-demo/assets/revise-terminal.mp4

Require bash

Set Shell "bash"
Set Width 1200
Set Height 600
Set FontSize 22
Set TypingSpeed 23ms
Set Theme "Catppuccin Mocha"
Set Padding 28
Set Framerate 30

Hide
Type "bash docs/assets/energon-plan-review-demo.sh revise"
Enter
Show

Wait+Screen@5s /›/
Type "Update Maya's plan to roll out to 10% first and roll back if invite failures exceed 2%. Then send her a Slack message from me explaining what changed."
Sleep 350ms
Enter

Wait+Screen@5s /Posted Noah's update to Maya in Slack/
Sleep 3.2s
