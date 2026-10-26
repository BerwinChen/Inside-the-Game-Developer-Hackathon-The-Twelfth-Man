// Render a small Markdown vocabulary using DOM nodes only. Model output is
// never inserted as HTML; links are restricted to HTTP(S).
const node=(tag,text)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;return el;};
export function safeURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
export function sourceLink(text,url,title){const a=node('a',text);a.className='chat-link';a.href=safeURL(url);a.target='_blank';a.rel='noopener noreferrer';if(title)a.title=title;return a;}
function inline(parent,text,refs,depth=0){
  if(depth>6){parent.append(document.createTextNode(text));return;}
  const pattern=/\uE000(\d+)\uE001|`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+)\*|~~([^~\n]+)~~/g;let cursor=0;
  for(const m of text.matchAll(pattern)){
    parent.append(document.createTextNode(text.slice(cursor,m.index)));let el;
    if(m[1]!=null){const ref=refs[Number(m[1])];el=ref?sourceLink(ref.text,ref.url,ref.title):node('span','');}
    else if(m[2])el=node('code',m[2]);
    else if(m[3])el=safeURL(m[4])?sourceLink(m[3],m[4]):node('span',m[3]);
    else{el=node(m[5]||m[6]?'strong':m[7]?'em':'del');inline(el,m[5]??m[6]??m[7]??m[8],refs,depth+1);}
    parent.append(el);cursor=m.index+m[0].length;
  }
  parent.append(document.createTextNode(text.slice(cursor)));
}
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(s=>s.trim());
const tableRule=line=>/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const listItem=line=>line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
const startsBlock=(lines,i)=>/^\s*(#{1,6}\s|```|~~~|>\s?|([-*_])(?:\s*\2){2,}\s*$)/.test(lines[i])||listItem(lines[i])||(i+1<lines.length&&lines[i].includes('|')&&tableRule(lines[i+1]));
export function renderMarkdown(parent,text,refs=[]){
  parent.replaceChildren();const lines=text.replace(/\r\n?/g,'\n').split('\n');let i=0;
  while(i<lines.length){
    const line=lines[i];if(!line.trim()){i++;continue;}
    const fence=line.match(/^\s*(```|~~~)(.*)$/);
    if(fence){const pre=node('pre'),code=node('code'),body=[];i++;while(i<lines.length&&!lines[i].trimStart().startsWith(fence[1]))body.push(lines[i++]);code.textContent=body.join('\n');pre.append(code);parent.append(pre);if(i<lines.length)i++;continue;}
    const heading=line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if(heading){const h=node('h'+Math.max(3,heading[1].length));inline(h,heading[2],refs);parent.append(h);i++;continue;}
    if(/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)){parent.append(node('hr'));i++;continue;}
    if(i+1<lines.length&&line.includes('|')&&tableRule(lines[i+1])){
      const wrap=node('div'),table=node('table'),head=node('thead'),tr=node('tr');wrap.className='chat-table-wrap';
      const headers=cells(line);for(const c of headers){const th=node('th');th.scope='col';inline(th,c,refs);tr.append(th);}head.append(tr);table.append(head);i+=2;const body=node('tbody');
      while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){const row=node('tr'),values=cells(lines[i++]);for(let c=0;c<headers.length;c++){const td=node('td');inline(td,values[c]??'',refs);row.append(td);}body.append(row);}table.append(body);wrap.append(table);parent.append(wrap);continue;
    }
    const item=listItem(line);
    if(item){const ordered=/^\d/.test(item[1]),list=node(ordered?'ol':'ul');if(ordered)list.start=parseInt(item[1],10);
      while(i<lines.length){const m=listItem(lines[i]);if(!m||/^\d/.test(m[1])!==ordered)break;const li=node('li');inline(li,m[2],refs);list.append(li);i++;}parent.append(list);continue;}
    if(/^\s*>/.test(line)){const quote=node('blockquote'),body=[];while(i<lines.length&&/^\s*>/.test(lines[i]))body.push(lines[i++].replace(/^\s*>\s?/,''));renderMarkdown(quote,body.join('\n'),refs);parent.append(quote);continue;}
    const p=node('p'),body=[line];i++;while(i<lines.length&&lines[i].trim()&&!startsBlock(lines,i))body.push(lines[i++]);inline(p,body.join('\n'),refs);parent.append(p);
  }
}
