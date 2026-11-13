# Renders every SVG here to a 3840x2160 PNG for slides.
# Why Edge headless: it ships with Windows, so no extra install. Not cairosvg: needs native DLLs on Windows.
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
Get-ChildItem $PSScriptRoot -Filter *.svg | ForEach-Object {
    $png = [IO.Path]::ChangeExtension($_.FullName, ".png")
    & $edge --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1920,1080 `
        "--screenshot=$png" ("file:///" + ($_.FullName -replace '\\', '/')) | Out-Null
    Write-Output "rendered $png"
}
