const token = "SEU_TOKEN_AQUI";

fetch("https://api.themoviedb.org/3/movie/popular?language=pt-BR", {
    method: "GET",
    headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`
    }
})
.then(response => response.json())
.then(data => {
    console.log(data);
})
.catch(error => {
    console.error("Erro:", error);
});