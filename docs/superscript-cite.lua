-- Pandoc Lua filter: Convert [N] citation markers to superscript in docx output.
--
-- Rules (per SJTU MBA thesis format):
--   1. In-text citation: "...压缩[2]。" → [2] becomes superscript
--   2. Reference list entry: "[1] 作者名..." → [1] stays normal (paragraph starts with [N])
--   3. Citations must NOT appear in headings

local function starts_with_cite(inlines)
  if #inlines == 0 then return false end
  local first = inlines[1]
  if first.t == "Str" then
    return first.text:match("^%s*%[%d+%]") ~= nil
  end
  return false
end

local function process_inlines(inlines, skip_first)
  local result = pandoc.List()
  for i, el in ipairs(inlines) do
    if el.t == "Str" then
      local pre, cite, post = el.text:match("^(.-)(%[%d[%d,%-–%s]*%])(.*)$")
      if cite then
        -- Skip [N] at paragraph start (reference list entry)
        if skip_first and i == 1 and (pre == "" or pre:match("^%s*$")) then
          result:insert(el)
          skip_first = false
        else
          if pre and pre ~= "" then
            result:insert(pandoc.Str(pre))
          end
          result:insert(pandoc.Superscript({pandoc.Str(cite)}))
          if post and post ~= "" then
            result:insert(pandoc.Str(post))
          end
        end
      else
        result:insert(el)
      end
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
