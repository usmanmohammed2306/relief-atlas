export type ContactPreferences={quiet_start:number;quiet_end:number;timezone:string};

export function contactAllowed(pref:ContactPreferences|Record<string,unknown>,now=new Date()):boolean {
  try {
    const hour=Number(new Intl.DateTimeFormat('en-US',{hour:'numeric',hourCycle:'h23',timeZone:String(pref.timezone)}).format(now));
    const start=Number(pref.quiet_start),end=Number(pref.quiet_end);
    const quiet=start===end?false:start<end?hour>=start&&hour<end:hour>=start||hour<end;
    return !quiet;
  }catch{return false;}
}
