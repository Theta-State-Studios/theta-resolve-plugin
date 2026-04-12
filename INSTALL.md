# Theta Review Plugin — Install Guide

## What You Need

- DaVinci Resolve **Studio** 18 or newer (the free version does not support plugins)
- Your Theta Review portal login (ask Morgan if you don't have one)

## Step 1: Copy the Plugin

Copy the **Theta Review** folder to:

**Mac:**
```
/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/
```

You can open Finder, press **Cmd+Shift+G**, and paste the path above to navigate there. Then drag the Theta Review folder in.

**Windows:**
```
C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\
```

## Step 2: Restart Resolve

Close and reopen DaVinci Resolve Studio.

## Step 3: Open the Plugin

In Resolve, go to **Workspace > Workflow Integrations > Theta Review**.

## Step 4: Sign In

Enter your name and password from the Theta Review portal. You only need to do this once.

## Troubleshooting

**Plugin doesn't appear in the menu?**
Make sure you're running DaVinci Resolve **Studio** (not the free version). Check that the Theta Review folder is in the correct location and contains `manifest.xml` at the top level.

**"Workflow Integrations" is greyed out?**
This means you're running the free version of Resolve. Plugins require Resolve Studio.

**Login not working?**
Check that you're connected to the internet and that your portal credentials are correct. Ask Morgan if you need a login.
