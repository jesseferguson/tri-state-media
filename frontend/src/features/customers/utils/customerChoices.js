import {
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Mail,
  MessageCircle,
  Phone,
} from "lucide-react";

export const CRM_STAGES = [
  ["active", "Active"],
  ["prospect", "Prospect"],
  ["onboarding", "Onboarding"],
  ["watch", "Watch"],
  ["inactive", "Inactive"],
];

export const INTERACTION_TYPES = [
  ["note", "Note"],
  ["email", "Email"],
  ["call", "Call"],
  ["meeting", "Meeting"],
  ["task", "Task"],
  ["status", "Status Update"],
  ["job_comment", "Job Comment"],
];

export const INTERACTION_STATUSES = [
  ["open", "Open"],
  ["waiting_customer", "Waiting on Customer"],
  ["waiting_internal", "Waiting Internally"],
  ["scheduled", "Scheduled"],
  ["closed", "Closed"],
];

export const TYPE_ICON = {
  email: Mail,
  call: Phone,
  meeting: CalendarDays,
  task: CheckCircle2,
  status: Clock3,
  job_comment: BriefcaseBusiness,
  note: MessageCircle,
};

export const CUSTOMER_PAGES = [
  ["overview", "Overview"],
  ["tickets", "Follow Ups"],
  ["work", "Work"],
  ["team", "Team"],
];
