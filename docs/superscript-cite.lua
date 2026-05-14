-- Pandoc Lua filter: Convert [N] citation markers to superscript in docx output.
--
-- Rules (per SJTU MBA thesis format):
--   1. In-text citation: "...压缩[2]。" → [2] becomes superscript
--   2. Reference list entry: "[1] 作者名..." → [1] stays normal (paragraph starts with [N])
--   3. Handles multiple [N] in a single Str element (common in CJK text)

local CITE_PATTERN = "%[%d[%d,%-–%s]*%]"

local function starts_with_cite(inlines)
  if #inlines == 0 then return false end
  local first = inlines[1]
  if first.t == "Str" then
    return first.text:match("^%s*" .. CITE_PATTERN) ~= nil
  end
  return false
end

-- Split a single Str text into fragments, converting all [N] to Superscript.
-- If skip_leading is true, the very first [N] at position 1 is kept as plain text.
local function split_citations(text, skip_leading)
  local result = pandoc.List()
  local pos = 1
  local first_match = true

  while pos <= #text do
    local s, e = text:find(CITE_PATTERN, pos)
    if not s then
      -- No more citations; emit remainder
      local tail = text:sub(pos)
      if tail ~= "" then
        result:insert(pandoc.Str(tail))
      end
      break
    end

    -- Emit text before the citation
    if s > pos then
      result:insert(pandoc.Str(text:sub(pos, s - 1)))
    end

    local cite = text:sub(s, e)

    -- Skip leading [N] in reference list entries
    if skip_leading and first_match and s == 1 then
      result:insert(pandoc.Str(cite))
    else
      result:insert(pandoc.Superscript({pandoc.Str(cite)}))
    end

    first_match = false
    pos = e + 1
  end

  return result
end

local function process_inlines(inlines, skip_first)
  local result = pandoc.List()
  for i, el in ipairs(inlines) do
    if el.t == "Str" and el.text:find(CITE_PATTERN) then
      local skip_leading = skip_first and i == 1
      local fragments = split_citations(el.text, skip_leading)
      result:extend(fragments)
    else
      result:insert(el)
    end
  end
  return result
end

function Para(el)
  el.content = process_inlines(el.content, starts_with_cite(el.content))
  return el
end

function Plain(el)
  el.content = process_inlines(el.content, starts_with_cite(el.content))
  return el
end
