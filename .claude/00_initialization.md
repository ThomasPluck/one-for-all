One-For-All (OFA) is a VSCode extension designed to operate as a parametric layout editor which abstracts away as much of the details of layout as possible while retaining an honest picture and giving a powerful parametric toolset with which students can design analog integrated circuits.

To begin with, we will start with the initialization screen - the initialization screen primarily exists to initialize a valid `One-For-All` project - a project has been correctly validated if the open Folder in vscode contains:

- A `.venv` folder created by `uv` set to Python 3.12 
- This Python needs to have gdsfactory installed
- A top-level ofa-config.json which records:
    - The PDK in usage (for this project, we will mostly hack on IHP)
    - Informs which gdsfactory pdk library must be installed

If any of these checks fail, the sidebar will display the OFA logo and beneath it a "choose a PDK" button - pressing this button should lead to a drop-down menu with supported PDK options (for now this will just be IHP SG13G2 - a 130nm BiCMOS Ge/As Process).

TODO:

- [x] Implement environment check
- [x] Implement environemnt initialization
- [x] Implement PDK selection
