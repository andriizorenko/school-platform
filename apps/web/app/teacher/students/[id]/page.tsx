"use client";

import { useParams } from "next/navigation";
import { TeacherStudentDetail } from "../../../../components/teacher-student-detail";

export default function Page() {
  const params = useParams<{ id: string }>();
  return <TeacherStudentDetail studentId={params.id} />;
}
