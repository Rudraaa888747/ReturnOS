# Generates the TypeScript route inventory used for API-parity review.
# Run from repository root: powershell -ExecutionPolicy Bypass -File backend-java/tools/route_inventory.ps1
$routes = Get-ChildItem backend/src/routes -Filter '*.ts'
foreach ($file in $routes) {
  $prefix = switch ($file.BaseName) {
    'auth' {'/api/v1/auth'} 'admin' {'/api/v1/admin'} 'warehouse' {'/api/v1/warehouse'}
    default { '/api/v1/' + $file.BaseName }
  }
  $lines = Get-Content $file.FullName
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'Router\.(get|post|put|patch|delete)\(') {
      $method = $Matches[1].ToUpper(); $path = ''
      for ($j = $i + 1; $j -lt [Math]::Min($i + 5, $lines.Count); $j++) {
        if ($lines[$j] -match '[''\"]([^''\"]+)[''\"]') { $path = $Matches[1]; break }
      }
      if ($path) { "{0,-6} {1}{2}" -f $method, $prefix, $path }
    }
  }
}
