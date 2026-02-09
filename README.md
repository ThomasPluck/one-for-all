<img 
    style="display: block; 
           margin-left: auto;
           margin-right: auto;
           width: 100%;"
    src="./docs/eyesore_logo.png" 
    alt="Owy ouchy my eyeballs">
</img>

<h2 align="center">A Graphical Parametric Analog Design Flow</h2>

---

### What is it?

**One-For-All** - is a VSCode extension designed to enable easy open-source analog tapeouts.

It achieves this by rejecting the typical Schematic ↔ Layout design loop in favor of a "Layout-As-Schematic" approach with a single graphical "layout-abstracted schematic".

In this way, analog IC design becomes a gradually more difficult verification problem in a single GUI with simulations, DRC and PEX which challenge verification test-cases defined by the engineer with no explicit schematic with which to compare their layout against.

We call this philosophy "Post-Modern Analog Design" (P-MAD) as it discards "the source of truth" schematic design band-aid and forces the engineer to confront integrated circuit realities immediately but does so in a way that is incremental, intuitive, and fun (well, at least we think so).

### How do I use it?

Well, it's a VSCode Extension - so just download it in the Extension Manager :)

If you're nerd 🤓 who wants to work on source, just fork this repo, the `.vscode` contains a debug script that will build and do everything for ya, plug in some new features and see if you can run the gauntlet of my review process.

Nerds 🤓 would also be wise to note this is the *VSCode Extension repo* and PDK repo's with all the fun per-process DRC/Simulation Generation/Parametric Layout/PEX are provided in independent `ofa-[PDK]` repos which are downloaded by the VSCode Extension.

