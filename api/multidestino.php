<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function responder(int $estado, array $datos): void
{
    http_response_code($estado);

    echo json_encode(
        $datos,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );

    exit;
}

function exigir(bool $condicion, string $mensaje): void
{
    if (!$condicion) {
        responder(422, [
            'ok' => false,
            'error' => $mensaje
        ]);
    }
}

function textoValido($valor, int $maximo = 12000): bool
{
    return is_string($valor)
        && trim($valor) !== ''
        && strlen($valor) <= $maximo;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');

    responder(405, [
        'ok' => false,
        'error' => 'Utiliza POST para generar una ruta.'
    ]);
}

$contenido = file_get_contents('php://input');

if ($contenido === false || strlen($contenido) > 500000) {
    responder(413, [
        'ok' => false,
        'error' => 'La solicitud es demasiado grande.'
    ]);
}

try {
    $datos = json_decode(
        $contenido,
        true,
        64,
        JSON_THROW_ON_ERROR
    );
} catch (JsonException $error) {
    responder(400, [
        'ok' => false,
        'error' => 'El contenido enviado no es JSON válido.'
    ]);
}

exigir(is_array($datos), 'La solicitud debe ser un objeto.');

$ruta = $datos['ruta'] ?? null;

exigir(
    is_array($ruta) && array_is_list($ruta),
    'La ruta debe ser una lista.'
);

exigir(
    count($ruta) >= 2 && count($ruta) <= 5,
    'Agrega entre 2 y 5 destinos.'
);

$totalDias = 0;
$nombres = [];

// Valida toda la solicitud antes de construir el itinerario.
foreach ($ruta as $indice => $parada) {
    exigir(is_array($parada), 'Hay un destino inválido.');

    $destino = $parada['destino'] ?? null;
    $dias = $parada['dias'] ?? null;
    $plan = $parada['plan'] ?? null;

    exigir(
        textoValido($destino, 160),
        'Cada destino debe tener un nombre.'
    );

    exigir(
        is_int($dias) && $dias >= 2 && $dias <= 10,
        "Los días de $destino deben estar entre 2 y 10."
    );

    exigir(
        array_key_exists('horasTraslado', $parada),
        "Falta el estado del traslado de $destino."
    );

    $horas = $parada['horasTraslado'];

    if ($indice === 0) {
        exigir(
            $horas === 0,
            'El primer destino debe tener cero horas de traslado entre destinos.'
        );
    } else {
        exigir(
            $horas === null,
            'La duración de los traslados debe quedar pendiente en este flujo.'
        );
    }

    $clave = function_exists('mb_strtolower')
        ? mb_strtolower(trim($destino), 'UTF-8')
        : strtolower(trim($destino));

    exigir(
        !in_array($clave, $nombres, true),
        'No repitas el mismo destino en esta ruta.'
    );

    $nombres[] = $clave;

    exigir(
        is_array($plan),
        "Falta la propuesta de $destino."
    );

    $bloques = $plan['bloques'] ?? null;

    exigir(
        is_array($bloques)
        && array_is_list($bloques)
        && count($bloques) === $dias,
        "La propuesta de $destino no contiene los $dias días solicitados."
    );

    foreach ($bloques as $bloque) {
        exigir(
            is_array($bloque),
            "Hay un día inválido en $destino."
        );

        foreach (['titulo', 'manana', 'tarde', 'noche'] as $campo) {
            exigir(
                textoValido($bloque[$campo] ?? null),
                "Falta el campo $campo en un día de $destino."
            );
        }
    }

    foreach ([
        'hospedaje',
        'comida',
        'estiloEtiqueta',
        'presupuestoEtiqueta'
    ] as $campo) {
        exigir(
            textoValido($plan[$campo] ?? null),
            "Falta el campo $campo en la propuesta de $destino."
        );
    }

    $totalDias += $dias;
}

exigir(
    $totalDias <= 30,
    'La ruta completa no debe superar 30 días.'
);

$bloquesFinales = [];
$destinos = [];
$hospedaje = [];
$comida = [];

$notas = [
    'La duración de los traslados está pendiente de confirmar.',
    'Se reserva provisionalmente el primer día de cada destino posterior para transporte y llegada. Esta reserva no representa una estimación de la duración real.'
];

$generico = false;

foreach ($ruta as $indice => $parada) {
    $destino = trim($parada['destino']);
    $dias = $parada['dias'];
    $horas = $parada['horasTraslado'];
    $plan = $parada['plan'];

    $diaInicio = count($bloquesFinales) + 1;

    $destinos[] = [
        'nombre' => $destino,
        'dias' => $dias,
        'diaInicio' => $diaInicio,
        'diaFin' => $diaInicio + $dias - 1,
        'horasTraslado' => $horas
    ];

    foreach ($plan['bloques'] as $diaLocal => $bloque) {
        $nuevoBloque = [
            'destino' => $destino,
            'titulo' => $destino . ' - ' . $bloque['titulo'],
            'manana' => $bloque['manana'],
            'tarde' => $bloque['tarde'],
            'noche' => $bloque['noche']
        ];

        // No inventa horas. Reserva un día provisional dentro
        // de la duración elegida, sin añadir días adicionales.
        if ($indice > 0 && $diaLocal === 0) {
            $origen = trim($ruta[$indice - 1]['destino']);

            $nuevoBloque['titulo'] =
                "Traslado de $origen a $destino - planificación provisional";

            $nuevoBloque['manana'] =
                "Tiempo reservado para salida y traslado de $origen a $destino. "
                . "Medio de transporte, horario y duración pendientes de confirmar.";

            $nuevoBloque['tarde'] =
                "Continuación del traslado o llegada, según el transporte elegido. "
                . "No se programan visitas hasta confirmar la duración.";

            $nuevoBloque['noche'] =
                "Tiempo reservado para llegada, alojamiento y descanso, "
                . "sujeto al horario de llegada confirmado.";

            $notas[] =
                "$origen a $destino: día $diaInicio reservado provisionalmente. "
                . "Revisar transporte y duración antes de confirmar reservas.";
        }

        $bloquesFinales[] = $nuevoBloque;
    }

    $hospedaje[] = "$destino: " . $plan['hospedaje'];
    $comida[] = "$destino: " . $plan['comida'];

    if (!empty($plan['generico'])) {
        $generico = true;

        $notas[] =
            "$destino utiliza una plantilla general; "
            . "sus actividades requieren concretarse antes de reservar.";
    }

    $notasDestino = $plan['notas'] ?? [];

    if (is_array($notasDestino)) {
        foreach (array_slice($notasDestino, 0, 5) as $nota) {
            if (textoValido($nota)) {
                $notas[] = "$destino: $nota";
            }
        }
    }
}

$primerPlan = $ruta[0]['plan'];

responder(200, [
    'ok' => true,
    'itinerario' => [
        'multidestino' => true,
        'destino' => implode(
            ' / ',
            array_column($destinos, 'nombre')
        ),
        'destinos' => $destinos,
        'dias' => $totalDias,
        'diasSolicitados' => $totalDias,
        'bloques' => $bloquesFinales,
        'hospedaje' => implode("\n\n", $hospedaje),
        'comida' => implode("\n\n", $comida),
        'notas' => $notas,
        'estiloEtiqueta' => $primerPlan['estiloEtiqueta'],
        'presupuestoEtiqueta' => $primerPlan['presupuestoEtiqueta'],
        'generico' => $generico,
        'validado' => false
    ]
]);