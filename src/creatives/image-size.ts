/** Read dimensions from bounded image headers; never decode pixels or execute media. */
export function imageSize(bytes: Uint8Array | null | undefined): {width:number;height:number}|null {
  if(!bytes || bytes.length<10)return null;
  const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const size=(width:number,height:number)=>width>0&&height>0?{width,height}:null;
  if(b.length>=24 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.toString('ascii',12,16)==='IHDR')return size(b.readUInt32BE(16),b.readUInt32BE(20));
  if(b[0]===255&&b[1]===216){
    let at=2;
    while(at+4<=b.length){
      if(b[at++]!==255)return null;
      while(b[at]===255)at++;
      const marker=b[at++];
      if(marker===0xd9||marker===0xda)return null;
      if(marker===0x01 || marker!==undefined&&marker>=0xd0&&marker<=0xd7)continue;
      if(at+2>b.length)return null;
      const length=b.readUInt16BE(at);if(length<2||at+length>b.length)return null;
      if(marker!==undefined&&[0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return length>=8?size(b.readUInt16BE(at+5),b.readUInt16BE(at+3)):null;
      at+=length;
    }
  }
  if(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
    const kind=b.toString('ascii',12,16);
    if(kind==='VP8X')return size(1+b.readUIntLE(24,3),1+b.readUIntLE(27,3));
    if(kind==='VP8 '&&b[23]===0x9d&&b[24]===1&&b[25]===0x2a)return size(b.readUInt16LE(26)&0x3fff,b.readUInt16LE(28)&0x3fff);
    if(kind==='VP8L'&&b[20]===0x2f){const bits=b.readUInt32LE(21);return size((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1);}
  }
  return null;
}
