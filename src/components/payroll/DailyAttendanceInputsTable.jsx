import { Fragment, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { requestJson } from '@/lib/appApi';

const metrics = [
  ['regular_hours', 'Regular Hrs'],
  ['overtime_hours', 'OT Hrs'],
  ['night_diff_hours', 'Night Diff Hrs'],
  ['late_minutes', 'Late Min'],
  ['undertime_minutes', 'Undertime Min'],
];

const punchFields = ['time_in', 'break_time_out', 'break_time_in', 'time_out'];

const shiftSchedule = log => {
  const name = log?.shift_name || log?.shift_setting_name || log?.work_schedule || '';
  const start = log?.shift_start_time || '';
  const end = log?.shift_end_time || '';
  if (!name && !start && !end) return '—';
  return `${name || 'Shift'}${start && end ? ` · ${start}–${end}` : ''}`;
};

export default function DailyAttendanceInputsTable({ days, logByDate, manualDays, setManualDays, systemDailyValue, time, onSave, dailyNotes = [], noteScope, onNotesSaved }) {
  const [editingDates, setEditingDates] = useState({});
  const [noteDate, setNoteDate] = useState('');
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const savedDates = useMemo(() => Object.fromEntries(days.map(date => [date, Boolean(manualDays[date]?.saved)])), [days, manualDays]);
  const update = (date, key, value) => setManualDays(current => ({ ...current, [date]: { ...(current[date] || {}), [key]: value } }));

  return <Card className="overflow-hidden">
    <div className="border-b px-4 py-3">
      <h2 className="font-semibold">Daily Attendance Inputs</h2>
      <p className="text-xs text-muted-foreground">Manual punches are editable. Regular hours, OT, night differential, late, and undertime are automatically computed from those punches.</p>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1750px] text-xs">
        <thead className="bg-muted/70">
          <tr>
            <th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Day / Status</th><th className="px-3 py-2 text-left">Day Type</th><th className="px-3 py-2 text-left">Shift Schedule</th><th className="px-3 py-2 text-left">System Punches<br /><span className="font-normal">(In 1 / Out 1 / In 2 / Out 2)</span></th>
            {metrics.map(([key, label]) => <th key={key} className="px-3 py-2 text-right">{label}<br /><span className="font-normal">System / Manual / Variance</span></th>)}
            <th className="px-3 py-2 text-left">Admin/HR Note</th><th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {days.map(date => {
            const log = logByDate.get(date) || {};
            const manual = manualDays[date] || {};
            const editing = editingDates[date] || !savedDates[date];
            const system = key => Number(systemDailyValue(log, key) || 0);
            const manualValue = key => Number(manual[key] ?? system(key));
            const varianceExists = metrics.some(([key]) => Math.abs(system(key) - manualValue(key)) > .005);
            const dailyNote = dailyNotes.find(item => String(item.attendanceDate || '').slice(0, 10) === date);
            return <Fragment key={date}>
              <tr className="border-t">
                <td rowSpan={3} className="whitespace-nowrap px-3 py-2 align-top font-medium">{date}<br /><span className="text-muted-foreground">{new Date(`${date}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short' })}</span></td>
                <td className="px-3 py-2"><span className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-semibold text-blue-700">SYSTEM</span></td>
                <td className="px-3 py-2">{log.day_type || 'No record'}<br /><span className="text-muted-foreground">{log.status || '—'}</span></td>
                <td className="px-3 py-2">{log.day_type || 'regular'}</td>
                <td className="whitespace-nowrap px-3 py-2">{shiftSchedule(log)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{punchFields.map((key, index) => <span key={key}>{time(log[key])}{index < 3 ? ' · ' : ''}</span>)}</td>
                {metrics.map(([key]) => <td key={key} className="px-3 py-2 text-right font-mono">{system(key).toFixed(2)}</td>)}
                <td rowSpan={3} className="min-w-44 px-3 py-2 align-middle"><div className="flex flex-col items-start gap-2">{dailyNote ? <span className="text-xs text-emerald-700">✓ Note saved</span> : varianceExists ? <span className="text-xs text-amber-700">● Note required</span> : <span className="text-xs text-muted-foreground">No note added</span>}<Button size="sm" variant="outline" onClick={() => { setNoteDate(date); setNoteText(dailyNote?.note || ''); }}>{dailyNote ? 'View/Edit Note' : 'Add Note'}</Button></div></td><td className="px-3 py-2 text-right">—</td>
              </tr>
              <tr>
                <td className="px-3 py-2"><span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">MANUAL</span></td><td className="px-3 py-2">—</td>
                <td className="px-3 py-2">{editing ? <Input className="h-8 w-24" value={manual.day_type ?? ''} placeholder="regular" onChange={event => update(date, 'day_type', event.target.value)} /> : (manual.day_type || 'regular')}</td><td className="px-3 py-2 text-muted-foreground">—</td>
                <td className="px-3 py-2"><div className="grid min-w-64 grid-cols-4 gap-1">{punchFields.map(key => editing ? <Input key={key} type="time" className="h-8 px-1 text-[10px]" value={manual[key] ?? ''} onChange={event => update(date, key, event.target.value)} /> : <span key={key} className="rounded border px-1 py-2 text-center">{time(manual[key])}</span>)}</div></td>
                {metrics.map(([key]) => <td key={key} className="px-3 py-2 text-right font-mono">{manualValue(key).toFixed(2)}</td>)}
                <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => { if (editing) { onSave?.(); setEditingDates(current => ({ ...current, [date]: false })); } else setEditingDates(current => ({ ...current, [date]: true })); }}>{editing ? 'Save' : 'Edit'}</Button></td>
              </tr>
              <tr>
                <td className="px-3 py-2"><span className="rounded border border-violet-200 bg-violet-50 px-2 py-1 font-semibold text-violet-700">VARIANCE</span></td><td className="px-3 py-2">—</td><td className="px-3 py-2">—</td><td className="px-3 py-2">—</td><td className="px-3 py-2">—</td>
                {metrics.map(([key]) => { const difference = system(key) - manualValue(key); return <td key={key} className={`px-3 py-2 text-right font-mono font-semibold ${difference > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{difference.toFixed(2)}</td>; })}<td className="px-3 py-2 text-right">—</td>
              </tr>
            </Fragment>;
          })}
        </tbody>
      </table>
    </div>
    <div className="flex flex-wrap gap-4 border-t px-4 py-3 text-xs"><b>Legend:</b><span className="text-blue-700">SYSTEM</span><span className="text-emerald-700">MANUAL</span><span className="text-violet-700">VARIANCE</span><span>System / Manual / Variance</span><span className="text-red-600">Positive variance is red; zero/negative is green.</span></div>
    <Dialog open={Boolean(noteDate)} onOpenChange={open => !open && setNoteDate('')}><DialogContent><DialogHeader><DialogTitle>Admin/HR Daily Note</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Date: {noteDate}</p><Textarea value={noteText} onChange={event => setNoteText(event.target.value)} placeholder="Add an attendance note or explain a manual variance for this date." /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setNoteDate('')}>Cancel</Button><Button disabled={!noteText.trim() || savingNote} onClick={async () => { setSavingNote(true); try { await requestJson('/api/payroll-reconciliation/daily-variance-notes', { method: 'POST', body: JSON.stringify({ ...noteScope, attendanceDate: noteDate, note: noteText }) }); onNotesSaved?.(); setNoteDate(''); } finally { setSavingNote(false); } }}>{savingNote ? 'Saving…' : 'Save Note'}</Button></div></DialogContent></Dialog>
  </Card>;
}
