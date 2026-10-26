
INSERT INTO resources (name, description, location)
SELECT v.name, v.description, v.location
FROM (
    VALUES
        ('Аудитория 101', 'Аудитория для учебных занятий', 'Корпус А, этаж 1'),
        ('Проектор 3', 'Переносной мультимедийный проектор', 'Учебный отдел'),
        ('Компьютерное место 12', 'Рабочее место с компьютером', 'Компьютерный класс')
) AS v(name, description, location)
WHERE NOT EXISTS (
    SELECT 1
    FROM resources r
    WHERE r.name = v.name
);
