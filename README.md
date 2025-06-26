# ObsidiAnki
This is a plugin for [Obsidian](https://obsidian.md/) that bridges the gap between defining flashcards in Obsidian and working with them in [Anki](https://apps.ankiweb.net/).

## Features

## Installation
In order to sync notes between Anki and Obsidian, a plugin is required on both sides to setup the connection.
These are
- [AnkiConnect](https://ankiweb.net/shared/info/2055492159) for Anki
- [ObsidiAnki](https://github.com/eevdriet/obsidi-anki) for Obsidian (this plugin)

Below are the steps to setup both applications.

### Obsidian
1. Make sure to **Turn on community plugins** under the **Community plugins** tab of Obsidian's settings
2. Search for and install the 'ObsidiAnki' plugin

The plugin is not available in [the official Community Plugins repository](https://obsidian.md/plugins) yet.

### Anki
1. Go to `Tools > Add-ons` and click on **Get Add-ons**
2. Input the plugin code 2055492159 for [AnkiConnect](https://ankiweb.net/shared/info/2055492159) and press OK
3. Restart Anki and return to the Add-ons menu; there should be a configuration menu under **Config**.
Make sure Obsidian is added as a known origin to the plugin:
<pre>
{
    "apiKey": null,
    "apiLogPath": null,
    "webBindAddress": "127.0.0.1",
    "webBindPort": 8765,
    "webCorsOrigin": "http://localhost",
    "webCorsOriginList": [
        "http://localhost",
        <strong>"app://obsidian.md"</strong>
    ]
}
</pre>

## Getting started
Detailed examples of how to use the plugin are given in the plugin's [wiki page](https://github.com/eevdriet/obsidi-anki/wiki)

## Contribution
If you want to contribute to the plugin, feel free to rase an issue or create a pull request on the [Github page](https://github.com/eevdriet/obsidi-anki)!
