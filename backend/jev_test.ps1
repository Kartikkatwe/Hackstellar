# Jev gate test via OpenRouter (no Python needed). Run: powershell -File jev_test.ps1
$envMap = @{}
Get-Content "$PSScriptRoot\.env" | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $envMap[$k.Trim()] = $v.Trim() }
$key = $envMap['OPENROUTER_API_KEY']
if (-not $key) { throw "Add OPENROUTER_API_KEY=... to .env" }

$questions = @{
  is_complaint = @{ type='noul'; instructions='Is the customer complaining about a problem (not praise, spam or a general question)?' }
  component    = @{ type='choice'; instructions='Which area of the grocery delivery business is this complaint about?'; criteria=[ordered]@{
    payments='Paying for an order: UPI, cards, wallets, failed or stuck payments, double charges, promo codes at checkout'
    delivery='Getting the order: late, missing, marked delivered but not received, delivery partner issues'
    login='Accessing the account: OTP not arriving, login errors, locked or hacked account'
    refunds='Getting money back after a cancellation or return: refund delays, wrong refund amount'
    product_quality='The items themselves: stale, damaged, expired, wrong or missing items'
    support='Customer support itself: no reply, bot loops, unhelpful or rude agents' } }
  impact       = @{ type='score'; instructions='How badly is the customer affected?'; criteria=@('Minor annoyance','Inconvenienced','Blocked from using the service','Harmed: lost money, safety or data') }
  money_lost   = @{ type='noul'; instructions='Did the customer lose money or get charged wrongly?' }
  churn_risk   = @{ type='noul'; instructions='Does the customer say they will leave, cancel, uninstall or switch to a competitor?' }
  legal_risk   = @{ type='noul'; instructions='Does the complaint mention legal action, consumer court, fraud, food safety or harassment?' }
}

$samples = @(
  'love the new app design, 10/10 guys',
  'Paid Rs 840 via GPay, money left my account but the app shows no order. Fix this now.',
  'bhai maine kal payment kiya, paisa kat gaya par order nahi aaya, customer care bhi nahi uthata',
  'Checkout hangs after I choose UPI and then says session expired. Third time today.',
  "I was charged twice for one order. If this isn't refunded I'm taking you to consumer court.",
  'OTP never arrives when I try to log in, been 2 days',
  'Order shows delivered but I never got it. Uninstalling, switching to a competitor.',
  'The milk was expired and the bread was mouldy.',
  'What time do you open on Sundays?'
)

$tot = 0; $totMs = 0
foreach ($s in $samples) {
  $body = @{ model='typesafe/jev-1.14'; state=$s; questions=$questions } | ConvertTo-Json -Depth 8
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-RestMethod -Uri 'https://openrouter.ai/api/alpha/decisions' -Method Post -ContentType 'application/json; charset=utf-8' `
         -Headers @{ Authorization = "Bearer $key" } -Body ([Text.Encoding]::UTF8.GetBytes($body))
  } catch { Write-Host "ERROR: $($_.Exception.Message)`n$($_.ErrorDetails.Message)"; break }
  $ms = $sw.ElapsedMilliseconds; $a = $r.answers; $t = [int]$r.usage.input_tokens
  $tot += $t; $totMs += $ms
  Write-Host "`n> $s"
  Write-Host ("  complaint={0:N2}  component={1} (conf {2:N2})  impact={3:N2}" -f $a.is_complaint.noul, $a.component.choice, $a.component.confidence, $a.impact.score)
  Write-Host ("  money={0:N2}  churn={1:N2}  legal={2:N2}  | {3} tok, {4} ms, {5}" -f $a.money_lost.noul, $a.churn_risk.noul, $a.legal_risk.noul, $t, $ms, $r.model)
}
if ($tot) { $n = $samples.Count; Write-Host ("`nAvg {0:N0} tokens, {1:N0} ms per complaint. 2,000 complaints ~ `${2:N4}" -f ($tot/$n), ($totMs/$n), ($tot/$n*2000*0.042/1e6)) }
