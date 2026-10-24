import React,{useState} from 'react';
import { validUnavailableDate } from './task-availability.js';
import './time-off.css';

export function HelperTimeOff({dates,timezone,disabled,onChange}:{dates:string[];timezone:string;disabled:boolean;onChange:(dates:string[])=>void}) {
  const [date,setDate]=useState('');
  const [error,setError]=useState('');
  function add(){
    if(!validUnavailableDate(date)){setError('Choose a complete, valid date.');return;}
    if(dates.includes(date)){setError('That date is already listed.');return;}
    if(dates.length>=60){setError('You can save up to 60 unavailable dates.');return;}
    onChange([...dates,date].sort());setDate('');setError('');
  }
  return <fieldset className="time-off" disabled={disabled}>
    <legend>Dates you cannot help</legend>
    <p>These are whole task days in {timezone||'your contact timezone'}. Quiet hours control when Relief contacts you. Neither setting guarantees availability on other dates.</p>
    <div className="time-off-add"><label>Unavailable date<input type="date" value={date} onChange={event=>{setDate(event.target.value);setError('');}}/></label><button type="button" className="secondary" disabled={!date||dates.length>=60} onClick={add}>Add date</button></div>
    {error&&<p role="alert">{error}</p>}
    {dates.length?<ul aria-label="Unavailable dates">{dates.map(day=><li key={day}><time dateTime={day}>{day}</time><button type="button" className="text-button" aria-label={`Remove unavailable date ${day}`} onClick={()=>onChange(dates.filter(value=>value!==day))}>Remove</button></li>)}</ul>:<p>No unavailable dates saved in this form.</p>}
    <p>Use Save preferences below to apply changes. Tasks you already accepted remain your responsibility. Open My offers and choose “I can’t do it” if you need to cancel.</p>
  </fieldset>;
}
