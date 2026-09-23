local LrHttp = import 'LrHttp'

local Bridge = {}

local function config()
  local ok, value = pcall(require, 'BridgeConfig')
  if not ok or type(value) ~= 'table' then
    error('กรุณาติดตั้งปลั๊กอินใหม่จาก Ciiya Sync')
  end
  if value.endpoint == nil or value.endpoint == '' or value.secret == nil or value.secret == '' then
    error('กรุณาเปิด Ciiya Sync และติดตั้งปลั๊กอิน Lightroom')
  end
  return value
end

local function headers(secret, contentType)
  local result = {
    { field = 'X-Ciiya-Sync-Secret', value = secret },
  }
  if contentType then
    result[#result + 1] = { field = 'Content-Type', value = contentType }
  end
  return result
end

local function encode(value)
  return string.gsub(tostring(value or ''), '([^%w%-_%.~])', function(character)
    return string.format('%%%02X', string.byte(character))
  end)
end

local function decode(value)
  value = string.gsub(value or '', '+', ' ')
  return string.gsub(value, '%%(%x%x)', function(hex)
    return string.char(tonumber(hex, 16))
  end)
end

local function parseLine(line)
  local result = {}
  for pair in string.gmatch(line or '', '[^&]+') do
    local key, value = string.match(pair, '^([^=]+)=(.*)$')
    if key then result[decode(key)] = decode(value) end
  end
  return result
end

local function assertResponse(body, responseHeaders, action)
  local status = responseHeaders and responseHeaders.status or 0
  if body == nil or status < 200 or status >= 300 then
    local details = parseLine(body or '')
    error(details.error or (action .. ' ไม่สำเร็จ กรุณาเปิด Ciiya Sync'))
  end
  return body
end

function Bridge.albums()
  local settings = config()
  local body, responseHeaders = LrHttp.get(
    settings.endpoint .. '/v1/albums',
    headers(settings.secret),
    5
  )
  assertResponse(body, responseHeaders, 'โหลดอัลบั้ม')

  local albums = {}
  for line in string.gmatch(body, '[^\r\n]+') do
    local values = parseLine(line)
    if values.albumId then
      albums[#albums + 1] = {
        id = values.albumId,
        title = values.title or 'Untitled album',
        photoCount = tonumber(values.photoCount or '0') or 0,
      }
    end
  end
  return albums
end

function Bridge.enqueue(albumId, sourcePath)
  local settings = config()
  local requestBody = 'albumId=' .. encode(albumId) .. '&sourcePath=' .. encode(sourcePath)
  local body, responseHeaders = LrHttp.post(
    settings.endpoint .. '/v1/export/enqueue',
    requestBody,
    headers(settings.secret, 'application/x-www-form-urlencoded; charset=utf-8'),
    'POST',
    10
  )
  assertResponse(body, responseHeaders, 'เพิ่มรูปเข้า Ciiya')
  return parseLine(string.match(body, '([^\r\n]+)') or '')
end

return Bridge
