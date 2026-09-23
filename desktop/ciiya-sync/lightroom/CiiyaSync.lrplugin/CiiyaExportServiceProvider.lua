local LrDialogs = import 'LrDialogs'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'

local Bridge = require 'CiiyaBridge'
local bind = LrView.bind

local Provider = {}

Provider.exportPresetFields = {
  { key = 'ciiyaAlbumId', default = '' },
  { key = 'ciiyaArchivePath', default = '' },
}
Provider.hideSections = { 'exportLocation' }
Provider.allowFileFormats = { 'JPEG' }
Provider.allowColorSpaces = { 'sRGB' }
Provider.canExportVideo = false

local function updateCanExport(propertyTable)
  if not propertyTable.ciiyaConnected then
    propertyTable.LR_cantExportBecause = propertyTable.ciiyaStatus or 'กรุณาเปิด Ciiya Sync'
  elseif propertyTable.ciiyaAlbumId == nil or propertyTable.ciiyaAlbumId == '' then
    propertyTable.LR_cantExportBecause = 'กรุณาเลือกอัลบั้ม Ciiya'
  elseif propertyTable.ciiyaArchivePath == nil or propertyTable.ciiyaArchivePath == '' then
    propertyTable.LR_cantExportBecause = 'กรุณาเลือกโฟลเดอร์เก็บไฟล์ในเครื่อง'
  else
    propertyTable.LR_cantExportBecause = nil
  end
end

local function refreshAlbums(propertyTable)
  propertyTable.ciiyaConnected = false
  propertyTable.ciiyaStatus = 'กำลังโหลดอัลบั้มจาก Ciiya Sync…'
  propertyTable.ciiyaAlbumItems = {
    { title = 'กำลังโหลด…', value = '' },
  }
  updateCanExport(propertyTable)

  LrTasks.startAsyncTask(function()
    local ok, albumsOrError = pcall(Bridge.albums)
    if not ok then
      propertyTable.ciiyaStatus = tostring(albumsOrError)
      propertyTable.ciiyaConnected = false
      updateCanExport(propertyTable)
      return
    end

    local items = {}
    local selectedExists = false
    for _, album in ipairs(albumsOrError) do
      items[#items + 1] = {
        title = album.title .. ' · ' .. tostring(album.photoCount) .. ' รูป',
        value = album.id,
      }
      if propertyTable.ciiyaAlbumId == album.id then selectedExists = true end
    end
    if #items == 0 then
      items[1] = { title = 'ยังไม่มีอัลบั้ม', value = '' }
    end
    if not selectedExists then propertyTable.ciiyaAlbumId = '' end
    propertyTable.ciiyaAlbumItems = items
    propertyTable.ciiyaConnected = true
    propertyTable.ciiyaStatus = #albumsOrError > 0
      and 'เชื่อมต่อ Ciiya Sync แล้ว'
      or 'เชื่อมต่อแล้ว แต่ยังไม่มีอัลบั้ม'
    updateCanExport(propertyTable)
  end)
end

function Provider.startDialog(propertyTable)
  propertyTable.ciiyaConnected = false
  propertyTable.ciiyaStatus = 'กำลังเชื่อมต่อ Ciiya Sync…'
  propertyTable.ciiyaAlbumItems = {
    { title = 'กำลังโหลด…', value = '' },
  }
  propertyTable:addObserver('ciiyaAlbumId', function()
    updateCanExport(propertyTable)
  end)
  propertyTable:addObserver('ciiyaArchivePath', function()
    updateCanExport(propertyTable)
  end)
  refreshAlbums(propertyTable)
end

function Provider.sectionsForTopOfDialog(viewFactory, propertyTable)
  return {
    {
      title = 'ส่งเข้า Ciiya และเก็บไฟล์ในเครื่อง',
      synopsis = bind 'ciiyaStatus',
      viewFactory:column {
        spacing = viewFactory:control_spacing(),
        fill_horizontal = 1,
        viewFactory:static_text {
          title = bind 'ciiyaStatus',
          fill_horizontal = 1,
        },
        viewFactory:row {
          viewFactory:static_text {
            title = 'อัลบั้ม Ciiya:',
            width = 120,
            alignment = 'right',
          },
          viewFactory:popup_menu {
            value = bind 'ciiyaAlbumId',
            items = bind 'ciiyaAlbumItems',
            enabled = bind 'ciiyaConnected',
            fill_horizontal = 1,
          },
          viewFactory:push_button {
            title = 'รีเฟรช',
            action = function() refreshAlbums(propertyTable) end,
          },
        },
        viewFactory:row {
          viewFactory:static_text {
            title = 'เก็บสำเนาที่:',
            width = 120,
            alignment = 'right',
          },
          viewFactory:edit_field {
            value = bind 'ciiyaArchivePath',
            fill_horizontal = 1,
            immediate = true,
          },
          viewFactory:push_button {
            title = 'เลือก…',
            action = function()
              local paths = LrDialogs.runOpenPanel {
                title = 'เลือกโฟลเดอร์เก็บไฟล์จาก Lightroom',
                canChooseFiles = false,
                canChooseDirectories = true,
                allowsMultipleSelection = false,
              }
              if paths and paths[1] then propertyTable.ciiyaArchivePath = paths[1] end
            end,
          },
        },
        viewFactory:static_text {
          title = 'ไฟล์ JPEG จะอยู่ในโฟลเดอร์นี้ และ Ciiya Sync จะอัปโหลดสำเนาเดียวกันเข้าอัลบั้ม',
          fill_horizontal = 1,
          height_in_lines = 2,
        },
      },
    },
  }
end

function Provider.updateExportSettings(exportSettings)
  exportSettings.LR_format = 'JPEG'
  exportSettings.LR_export_colorSpace = 'sRGB'
end

local function collisionSafePath(folderPath, sourcePath)
  local leaf = LrPathUtils.leafName(sourcePath)
  local stem, extension = string.match(leaf, '^(.*)(%.[^%.]+)$')
  if not stem then
    stem = leaf
    extension = ''
  end

  local candidate = LrPathUtils.child(folderPath, leaf)
  local sequence = 2
  while LrFileUtils.exists(candidate) do
    candidate = LrPathUtils.child(
      folderPath,
      stem .. '-' .. tostring(sequence) .. extension
    )
    sequence = sequence + 1
  end
  return candidate
end

function Provider.processRenderedPhotos(functionContext, exportContext)
  local settings = assert(exportContext.propertyTable)
  local archivePath = settings.ciiyaArchivePath
  local albumId = settings.ciiyaAlbumId
  if not archivePath or archivePath == '' or not albumId or albumId == '' then
    LrDialogs.message('Ciiya Sync', 'กรุณาเลือกอัลบั้มและโฟลเดอร์เก็บไฟล์', 'critical')
    return
  end

  LrFileUtils.createAllDirectories(archivePath)
  local total = exportContext.exportSession:countRenditions()
  local progress = exportContext:configureProgress {
    title = total > 1
      and 'กำลังเตรียม ' .. tostring(total) .. ' รูปสำหรับ Ciiya'
      or 'กำลังเตรียมรูปสำหรับ Ciiya',
  }

  for index, rendition in exportContext:renditions { stopIfCanceled = true } do
    local success, pathOrMessage = rendition:waitForRender()
    if success then
      local destination = collisionSafePath(archivePath, pathOrMessage)
      local copied, copyResult = pcall(LrFileUtils.copy, pathOrMessage, destination)
      if not copied or copyResult == false then
        rendition:uploadFailed('ไม่สามารถเก็บไฟล์ในเครื่อง: ' .. tostring(copyResult))
      else
        local queued, queueResult = pcall(Bridge.enqueue, albumId, destination)
        if not queued then
          rendition:uploadFailed(
            'เก็บไฟล์ในเครื่องแล้ว แต่ยังส่งเข้า Ciiya ไม่สำเร็จ: ' .. tostring(queueResult)
          )
        end
      end
    else
      rendition:uploadFailed(pathOrMessage)
    end
    progress:setPortionComplete(index / total)
    if progress:isCanceled() then break end
  end
  progress:done()
end

return Provider
