import { CalendarPage } from "../../../components/calendar-page";

export default function Page() {
  return <CalendarPage
    role="MANAGER"
    query="sessionType=FIRST"
    title="Перші уроки"
    subtitle="Окремий календар перших занять для швидкого контролю та координації."
  />;
}
