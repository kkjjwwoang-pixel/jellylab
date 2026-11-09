Set-Location -LiteralPath "C:\Users\kkjjw\Documents\GitHub\jelly-lab"
Write-Output "Starting Git setup in $(Get-Location)"
git init
git branch -M main
git remote remove origin 2>$null
git remote add origin https://github.com/kkjjwwo/jellylab.git
git add .
git commit -m "feat: initial commit for Slimy (jelly-lab)"
git push -u origin main
