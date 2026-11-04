; Gỡ sạch mục "Combine files in Folioscope..." khỏi menu chuột phải khi gỡ cài đặt (HKCU, không cần quyền quản trị).
!macro FolioscopeVerb ext
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.${ext}\shell\Folioscope.Combine"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Gói menu Windows 11 (nếu đã bật)
  nsExec::Exec 'powershell -NoProfile -WindowStyle Hidden -Command "Get-AppxPackage -Name Folioscope.ShellExtension | Remove-AppxPackage"'
  Pop $0
  !insertmacro FolioscopeVerb pdf
  !insertmacro FolioscopeVerb doc
  !insertmacro FolioscopeVerb docx
  !insertmacro FolioscopeVerb xls
  !insertmacro FolioscopeVerb xlsx
  !insertmacro FolioscopeVerb ppt
  !insertmacro FolioscopeVerb pptx
  !insertmacro FolioscopeVerb odt
  !insertmacro FolioscopeVerb ods
  !insertmacro FolioscopeVerb odp
  !insertmacro FolioscopeVerb rtf
  !insertmacro FolioscopeVerb txt
  !insertmacro FolioscopeVerb csv
  !insertmacro FolioscopeVerb html
  !insertmacro FolioscopeVerb htm
  !insertmacro FolioscopeVerb jpg
  !insertmacro FolioscopeVerb jpeg
  !insertmacro FolioscopeVerb png
  !insertmacro FolioscopeVerb gif
  !insertmacro FolioscopeVerb bmp
  !insertmacro FolioscopeVerb tif
  !insertmacro FolioscopeVerb tiff
  !insertmacro FolioscopeVerb webp
!macroend
